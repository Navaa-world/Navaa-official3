/* NAVAA REFER & EARN — isolated on-chain dashboard */
(() => {
  "use strict";
  if (window.NAVAA_REFER_INITIALIZED) return;
  window.NAVAA_REFER_INITIALIZED = true;

  const STAKE_ADDRESS = "0xE46E8b1AC4CDFAE9CF9d1D9B0BD6D1705CB5B8C9";
  const CHAIN_ID = 137n;
  const RECENT_FALLBACK_BLOCKS = 500000;
  const LOG_CHUNK = 5000;
  const RPC_URLS = [
    "https://polygon.drpc.org",
    "https://polygon-bor-rpc.publicnode.com"
  ];
  const ABI = [
    "function referralBalance(address user) view returns (uint256)",
    "function withdrawReferralReward(uint256 amount)",
    "event Staked(address indexed user,uint256 indexed positionId,uint256 amount,address indexed referrer,uint256 referralReward)",
    "event ReferralWithdrawn(address indexed user,uint256 gross,uint256 fee,uint256 net)"
  ];
  const iface = new ethers.Interface(ABI);
  const STAKED_TOPIC = iface.getEvent("Staked").topicHash;
  const WITHDRAW_TOPIC = iface.getEvent("ReferralWithdrawn").topicHash;
  const $ = id => document.getElementById(id);

  let walletProvider=null, signer=null, readContract=null, writeContract=null, account=null;
  let eventProviders=[], eventProvider=null, deploymentBlock=null, historyStart=null;
  let lastScannedBlock=null, cachedStakes=[], cachedWithdrawals=[];
  let busy=false, refreshRunning=false, refreshTimer=null, lastRefreshAt=0;

  const setText=(id,value)=>{const el=$(id);if(el)el.textContent=value;};
  const short=value=>value?value.slice(0,6)+"..."+value.slice(-4):"—";
  const format=value=>{
    try{return Number(ethers.formatUnits(value,18)).toLocaleString("en-US",{maximumFractionDigits:4});}
    catch{return "—";}
  };
  const txUrl=hash=>"https://polygonscan.com/tx/"+hash;
  const make=(tag,cls,value)=>{
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(value!==undefined)el.textContent=value;
    return el;
  };
  function status(message,error=false){
    const el=$("referStatus");
    if(el){el.textContent=message;el.style.color=error?"#f6465d":"";}
  }
  function linkValue(){
    return account?location.origin+location.pathname+"?ref="+encodeURIComponent(account):"";
  }
  function updateLink(){
    const input=$("referLinkInput"),copy=$("referCopyBtn"),share=$("referShareBtn");
    if(input)input.value=linkValue();
    if(copy)copy.disabled=!account;
    if(share)share.disabled=!account;
    setText("referLinkStatus",account?"Your personal referral link is ready.":"Connect your Polygon wallet to generate a link.");
  }
  function emptyTable(message){
    const body=$("referListBody");if(!body)return;
    body.replaceChildren();
    const row=make("tr"),cell=make("td","refer-empty",message);
    cell.colSpan=4;row.appendChild(cell);body.appendChild(row);
  }
  function reset(){
    ["referLifetimeEarned","referTotalCount","referAvailable","referWithdrawn","referClaimable"].forEach(id=>setText(id,"—"));
    emptyTable("Connect your wallet to load referral activity.");
    const history=$("referHistoryList");
    if(history)history.replaceChildren(make("div","refer-empty","Connect your wallet to load referral history."));
    const btn=$("referWithdrawBtn"),input=$("referWithdrawAmount"),max=$("referMaxBtn");
    if(btn)btn.disabled=true;if(input)input.disabled=true;if(max)max.disabled=true;
    updateLink();status("Connect your wallet to view your referral dashboard.");
  }

  async function connectWallet(){
    if(!window.ethereum)throw new Error("Open NAVAA in MetaMask, Trust Wallet or SafePal.");
    walletProvider=new ethers.BrowserProvider(window.ethereum,"any");
    const accounts=await window.ethereum.request({method:"eth_accounts"});
    if(!accounts||!accounts.length){
      account=null;signer=null;readContract=null;writeContract=null;return false;
    }
    const network=await walletProvider.getNetwork();
    if(network.chainId!==CHAIN_ID)throw new Error("Please switch your wallet to Polygon Mainnet.");
    account=ethers.getAddress(accounts[0]);
    signer=await walletProvider.getSigner();
    readContract=new ethers.Contract(STAKE_ADDRESS,ABI,walletProvider);
    writeContract=new ethers.Contract(STAKE_ADDRESS,ABI,signer);
    await setupEventProviders();
    return true;
  }

  async function setupEventProviders(){
    if(eventProviders.length)return;
    for(const url of RPC_URLS){
      try{
        const p=new ethers.JsonRpcProvider(url,{name:"polygon",chainId:137});
        const network=await p.getNetwork();
        if(network.chainId===CHAIN_ID){
          await p.getBlockNumber();
          eventProviders.push(p);
        }
      }catch(error){console.warn("NAVAA referral RPC unavailable:",url,error);}
    }
    if(walletProvider)eventProviders.push(walletProvider);
    if(!eventProviders.length)throw new Error("No Polygon RPC is available for referral history.");
    eventProvider=eventProviders[0];
  }

  async function findDeploymentBlock(){
    if(deploymentBlock!==null)return deploymentBlock;
    const latest=await eventProvider.getBlockNumber();
    let low=0,high=latest;
    try{
      // Binary-search the first block containing the deployed contract.
      const latestCode=await eventProvider.getCode(STAKE_ADDRESS,latest);
      if(!latestCode||latestCode==="0x")throw new Error("Staking contract code was not found.");
      while(low<high){
        const mid=Math.floor((low+high)/2);
        const code=await eventProvider.getCode(STAKE_ADDRESS,mid);
        if(code&&code!=="0x")high=mid;else low=mid+1;
      }
      deploymentBlock=low;
      historyStart=low;
    }catch(error){
      console.warn("Could not determine contract deployment block; using recent history window.",error);
      deploymentBlock=Math.max(0,latest-RECENT_FALLBACK_BLOCKS);
      historyStart=deploymentBlock;
    }
    return deploymentBlock;
  }

  async function queryLogs(filter){
    let lastError;
    for(const p of eventProviders){
      try{return await p.getLogs(filter);}
      catch(error){lastError=error;console.warn("Referral event RPC failed; trying fallback.",error);}
    }
    throw lastError||new Error("Polygon event query failed.");
  }

  async function scanRange(from,to){
    const accountTopic=ethers.zeroPadValue(account,32).toLowerCase();
    const [stakeLogs,withdrawLogs]=await Promise.all([
      queryLogs({address:STAKE_ADDRESS,fromBlock:from,toBlock:to,topics:[STAKED_TOPIC,null,null,accountTopic]}),
      queryLogs({address:STAKE_ADDRESS,fromBlock:from,toBlock:to,topics:[WITHDRAW_TOPIC,accountTopic]})
    ]);
    const stakes=stakeLogs.map(log=>({parsed:iface.parseLog(log),blockNumber:log.blockNumber,transactionHash:log.transactionHash,logIndex:log.index??log.logIndex}));
    const withdrawals=withdrawLogs.map(log=>({parsed:iface.parseLog(log),blockNumber:log.blockNumber,transactionHash:log.transactionHash,logIndex:log.index??log.logIndex}));
    return {stakes,withdrawals};
  }

  async function loadAllReferralEvents(){
    const latest=await eventProvider.getBlockNumber();
    if(lastScannedBlock===null){
      await findDeploymentBlock();
      lastScannedBlock=historyStart-1;
    }
    const from=Math.max(historyStart,lastScannedBlock+1);
    if(from>latest)return {latest,from:historyStart,stakes:cachedStakes,withdrawals:cachedWithdrawals,fullHistory:historyStart===deploymentBlock};
    const ranges=[];
    for(let start=from;start<=latest;start+=LOG_CHUNK)ranges.push([start,Math.min(start+LOG_CHUNK-1,latest)]);
    let cursor=0;
    const newStakes=[],newWithdrawals=[];
    const workers=Array.from({length:3},async()=>{
      while(cursor<ranges.length){
        const index=cursor++,[start,end]=ranges[index];
        const events=await scanRange(start,end);
        newStakes.push(...events.stakes);newWithdrawals.push(...events.withdrawals);
        setText("referScanNote","Loading full referral history… scanned through block "+end.toLocaleString()+".");
      }
    });
    await Promise.all(workers);
    cachedStakes.push(...newStakes);cachedWithdrawals.push(...newWithdrawals);
    cachedStakes.sort((a,b)=>a.blockNumber-b.blockNumber||(a.logIndex||0)-(b.logIndex||0));
    cachedWithdrawals.sort((a,b)=>a.blockNumber-b.blockNumber||(a.logIndex||0)-(b.logIndex||0));
    lastScannedBlock=latest;
    return {latest,from:historyStart,stakes:cachedStakes,withdrawals:cachedWithdrawals,fullHistory:historyStart===deploymentBlock};
  }

  function renderReferrals(events){
    const body=$("referListBody");if(!body)return;
    body.replaceChildren();
    const firstByWallet=new Map();
    for(const item of events){
      const a=item.parsed.args,who=String(a.user).toLowerCase();
      if(!firstByWallet.has(who))firstByWallet.set(who,item);
    }
    const rows=[...firstByWallet.values()];
    if(!rows.length){emptyTable("No wallets have completed a first stake using your referral link yet.");return;}
    for(const item of rows){
      const a=item.parsed.args,row=make("tr");
      row.append(make("td","refer-wallet-cell",short(a.user)),make("td","",format(a.amount)+" NAVAA"),make("td","",format(a.referralReward)+" NAVAA"));
      const cell=make("td"),link=make("a","","View transaction");
      link.href=txUrl(item.transactionHash);link.target="_blank";link.rel="noopener noreferrer";
      cell.appendChild(link);row.appendChild(cell);body.appendChild(row);
    }
  }

  function renderHistory(stakes,withdrawals){
    const box=$("referHistoryList");if(!box)return;
    const rows=[
      ...stakes.map(x=>({kind:"Referral reward generated",gross:BigInt(x.parsed.args.referralReward),fee:0n,net:BigInt(x.parsed.args.referralReward),block:x.blockNumber,hash:x.transactionHash})).filter(x=>x.gross>0n),
      ...withdrawals.map(x=>({kind:"Referral reward withdrawn",gross:BigInt(x.parsed.args.gross),fee:BigInt(x.parsed.args.fee),net:BigInt(x.parsed.args.net),block:x.blockNumber,hash:x.transactionHash}))
    ].sort((a,b)=>b.block-a.block).slice(0,50);
    box.replaceChildren();
    if(!rows.length){box.appendChild(make("div","refer-empty","No referral reward or withdrawal transactions found yet."));return;}
    for(const item of rows){
      const row=make("article","refer-history-item"),left=make("div"),right=make("div","refer-history-amount");
      left.append(make("strong","",item.kind),make("small","","Block "+item.block+" · "+short(item.hash)));
      right.append(make("strong","",format(item.net)+" NAVAA"));
      if(item.fee>0n)right.append(make("small","","Fee "+format(item.fee)+" NAVAA · Gross "+format(item.gross)));
      const link=make("a","","View on PolygonScan");
      link.href=txUrl(item.hash);link.target="_blank";link.rel="noopener noreferrer";
      right.appendChild(link);row.append(left,right);box.appendChild(row);
    }
  }

  function updateWithdrawalHint(balance){
    const input=$("referWithdrawAmount"),hint=$("referAmountHint");if(!input||!hint)return;
    const value=(input.value||"").trim();
    if(balance===undefined){hint.textContent="Connect your wallet to load your reward balance.";return;}
    if(!value){hint.textContent="Available: "+format(balance)+" NAVAA. Enter an amount or select MAX.";return;}
    try{
      const amount=ethers.parseUnits(value,18);
      hint.textContent=amount<=0n?"Enter an amount greater than zero.":amount>balance?"Amount is higher than your available balance.":"Selected "+format(amount)+" NAVAA. Contract fees, if any, are applied on-chain.";
    }catch{hint.textContent="Enter a valid amount with up to 18 decimal places.";}
  }

  async function refresh(){
    if(refreshRunning||!account||!readContract)return;
    refreshRunning=true;
    try{
      const balance=await readContract.referralBalance(account);
      setText("referAvailable",format(balance));
      setText("referClaimable",format(balance)+" NAVAA");
      const input=$("referWithdrawAmount"),max=$("referMaxBtn"),btn=$("referWithdrawBtn");
      if(input)input.disabled=balance===0n||busy;
      if(max)max.disabled=balance===0n||busy;
      if(btn)btn.disabled=balance===0n||busy;
      if(balance===0n&&input)input.value="";
      updateWithdrawalHint(balance);
      status("Available reward balance read directly from the staking contract.");

      try{
        const events=await loadAllReferralEvents();
        const lifetime=events.stakes.reduce((sum,x)=>sum+BigInt(x.parsed.args.referralReward),0n);
        const withdrawn=events.withdrawals.reduce((sum,x)=>sum+BigInt(x.parsed.args.net),0n);
        const unique=new Set(events.stakes.map(x=>String(x.parsed.args.user).toLowerCase()));
        setText("referLifetimeEarned",format(lifetime)+" NAVAA");
        setText("referTotalCount",String(unique.size));
        setText("referWithdrawn",format(withdrawn)+" NAVAA");
        renderReferrals(events.stakes);renderHistory(events.stakes,events.withdrawals);
        setText("referScanNote",events.fullHistory?"Complete event history scanned from staking contract deployment block "+events.from.toLocaleString()+".":"Showing recent referral events from block "+events.from.toLocaleString()+". Earlier activity may be missing.");
        status("Referral dashboard updated from Polygon Mainnet.");
      }catch(error){
        console.error("NAVAA referral history scan failed:",error);
        setText("referLifetimeEarned","History unavailable");
        setText("referTotalCount","—");
        setText("referWithdrawn","History unavailable");
        emptyTable("Referral event history could not be loaded. Available rewards above are still read from the contract.");
        const box=$("referHistoryList");if(box)box.replaceChildren(make("div","refer-empty","Referral history is temporarily unavailable. Please retry."));
        setText("referScanNote","Polygon RPC failed to return referral event history. The claimable balance is independently read from the staking contract.");
        status("Available balance loaded, but referral history needs another RPC attempt.",true);
      }
      lastRefreshAt=Date.now();
    }catch(error){
      console.error("NAVAA referral contract read failed:",error);
      setText("referAvailable","Read error");setText("referClaimable","Read error");
      const btn=$("referWithdrawBtn");if(btn)btn.disabled=true;
      status(error?.shortMessage||error?.reason||error?.message||"Could not read referral balance from Polygon.",true);
    }finally{refreshRunning=false;}
  }

  async function setMax(){
    if(!readContract||!account)return;
    try{
      const balance=await readContract.referralBalance(account),input=$("referWithdrawAmount");
      if(input)input.value=ethers.formatUnits(balance,18);
      updateWithdrawalHint(balance);
    }catch(error){status("Could not load the available referral balance.",true);}
  }

  async function withdraw(){
    if(busy||!account||!readContract||!writeContract)return;
    const input=$("referWithdrawAmount"),value=(input?.value||"").trim();
    if(!value){status("Enter an amount or press MAX.",true);input?.focus();return;}
    let amount;
    try{amount=ethers.parseUnits(value,18);}catch{status("Enter a valid NAVAA amount with up to 18 decimal places.",true);return;}
    if(amount<=0n){status("Withdrawal amount must be greater than zero.",true);return;}
    busy=true;
    const btn=$("referWithdrawBtn"),max=$("referMaxBtn");
    if(btn)btn.disabled=true;if(max)max.disabled=true;if(input)input.disabled=true;
    try{
      const balance=await readContract.referralBalance(account);
      if(amount>balance)throw new Error("Insufficient referral rewards. Available: "+format(balance)+" NAVAA.");
      status("Confirm withdrawal of "+format(amount)+" NAVAA in your wallet.");
      const tx=await writeContract.withdrawReferralReward(amount);
      status("Withdrawal submitted. Waiting for Polygon confirmation…");
      await tx.wait();
      if(input)input.value="";
      status("Withdrawal confirmed. Updating your remaining reward balance…");
      cachedStakes=[];cachedWithdrawals=[];lastScannedBlock=null;
      await refresh();
    }catch(error){
      console.error("NAVAA referral withdrawal failed:",error);
      status(error?.shortMessage||error?.reason||error?.message||"Referral withdrawal failed.",true);
    }finally{busy=false;if(account)await refresh();}
  }

  async function copyLink(){
    const url=linkValue();if(!url)return;
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(url);
      else{
        const input=$("referLinkInput");input?.focus();input?.select();
        if(!document.execCommand("copy"))throw new Error("Copy is unavailable.");
      }
      setText("referLinkStatus","Referral link copied.");
    }catch(error){setText("referLinkStatus",error.message||"Could not copy the link.");}
  }

  function openShare(url){
    const anchor=document.createElement("a");
    anchor.href=url;anchor.target="_blank";anchor.rel="noopener noreferrer";
    document.body.appendChild(anchor);anchor.click();anchor.remove();
  }
  function shareLink(){
    const url=linkValue();if(!url)return;
    const message="Join me on NAVAA and use my referral link: "+url;
    if(typeof navigator.share==="function"){
      navigator.share({title:"Join NAVAA",text:message,url}).then(
        ()=>setText("referLinkStatus","Referral link shared successfully."),
        error=>{
          if(error?.name==="AbortError"){setText("referLinkStatus","Share cancelled.");return;}
          openShare("https://wa.me/?text="+encodeURIComponent(message));
          setText("referLinkStatus","Opening WhatsApp to share your referral link.");
        }
      );
      return;
    }
    openShare("https://wa.me/?text="+encodeURIComponent(message));
    setText("referLinkStatus","Opening WhatsApp. Select a contact or group.");
  }

  async function waitForMainWallet(){
    for(let i=0;i<40;i++){
      try{if(await connectWallet()){updateLink();await refresh();return true;}}
      catch(error){status(error.message||"Could not connect referral dashboard to wallet.",true);return false;}
      await new Promise(resolve=>setTimeout(resolve,300));
    }
    status("Wallet connection was not detected. Please reconnect.",true);return false;
  }

  function bind(){
    $("referCopyBtn")?.addEventListener("click",copyLink);
    $("referShareBtn")?.addEventListener("click",shareLink);
    $("referWithdrawBtn")?.addEventListener("click",withdraw);
    $("referMaxBtn")?.addEventListener("click",setMax);
    $("referWithdrawAmount")?.addEventListener("input",()=>{
      if(!account||!readContract){updateWithdrawalHint(undefined);return;}
      readContract.referralBalance(account).then(updateWithdrawalHint).catch(()=>updateWithdrawalHint(undefined));
    });
    $("connectBtn")?.addEventListener("click",waitForMainWallet);
    document.querySelectorAll('[data-page-target="refer"]').forEach(button=>{
      button.addEventListener("click",()=>setTimeout(()=>{if(account)refresh();},350));
    });
    if(window.ethereum?.on){
      window.ethereum.on("accountsChanged",async()=>{
        account=null;signer=null;readContract=null;writeContract=null;
        eventProviders=[];eventProvider=null;deploymentBlock=null;historyStart=null;
        lastScannedBlock=null;cachedStakes=[];cachedWithdrawals=[];
        try{if(await connectWallet()){updateLink();await refresh();}else reset();}
        catch(error){reset();status(error.message||"Wallet account changed.",true);}
      });
      window.ethereum.on("chainChanged",()=>location.reload());
    }
  }

  async function init(){
    bind();reset();
    try{if(await connectWallet()){updateLink();await refresh();}}
    catch(error){status(error.message||"Referral dashboard could not connect to Polygon.",true);}
    if(refreshTimer)clearInterval(refreshTimer);
    refreshTimer=setInterval(()=>{
      if(account&&!busy&&$("pageRefer")?.classList.contains("active")&&Date.now()-lastRefreshAt>25000)refresh();
    },5000);
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
