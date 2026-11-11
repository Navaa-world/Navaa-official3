/* NAVAA REFER & EARN — isolated dashboard module */
(() => {
  "use strict";
  if (window.NAVAA_REFER_INITIALIZED) return;
  window.NAVAA_REFER_INITIALIZED = true;

  const STAKE_ADDRESS = "0xE46E8b1AC4CDFAE9CF9d1D9B0BD6D1705CB5B8C9";
  const CHAIN_ID = 137n;
  const SCAN_WINDOW = 500000;
  const CHUNK_SIZE = 25000;
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

  let walletProvider = null;
  let readProvider = null;
  let signer = null;
  let writeContract = null;
  let readContract = null;
  let account = null;
  let busy = false;
  let refreshTimer = null;
  let refreshRunning = false;

  const setText = (id,value) => { const el=$(id); if(el) el.textContent=value; };
  const short = value => value ? value.slice(0,6)+"..."+value.slice(-4) : "—";
  const format = value => {
    try { return Number(ethers.formatUnits(value,18)).toLocaleString("en-US",{maximumFractionDigits:4}); }
    catch { return "—"; }
  };
  const txUrl = hash => "https://polygonscan.com/tx/"+hash;
  const make = (tag,cls,value) => {
    const el=document.createElement(tag);
    if(cls) el.className=cls;
    if(value!==undefined) el.textContent=value;
    return el;
  };
  function status(message,error=false) {
    const el=$("referStatus");
    if(el) { el.textContent=message; el.style.color=error?"#f6465d":""; }
  }
  function linkValue() {
    return account ? location.origin+location.pathname+"?ref="+encodeURIComponent(account) : "";
  }
  function updateLink() {
    const input=$("referLinkInput"),copy=$("referCopyBtn"),share=$("referShareBtn");
    if(input) input.value=linkValue();
    if(copy) copy.disabled=!account;
    if(share) share.disabled=!account;
    setText("referLinkStatus",account?"Your referral link is ready to share.":"Connect wallet to generate your link.");
  }
  function emptyTable(message) {
    const body=$("referListBody"); if(!body) return;
    body.replaceChildren();
    const row=make("tr"),cell=make("td","refer-empty",message);
    cell.colSpan=4; row.appendChild(cell); body.appendChild(row);
  }
  function reset() {
    ["referLifetimeEarned","referTotalCount","referAvailable","referWithdrawn","referClaimable"].forEach(id=>setText(id,"—"));
    emptyTable("Connect wallet to load your referral activity.");
    const history=$("referHistoryList");
    if(history) history.replaceChildren(make("div","refer-empty","Connect wallet to load your referral history."));
    const btn=$("referWithdrawBtn"); if(btn) btn.disabled=true;
    setText("referScanNote","Referral activity is read directly from Polygon staking events.");
    updateLink();
    status("Connect your wallet to view referral rewards.");
  }

  async function setupReadProvider() {
    let lastError;
    for(const url of RPC_URLS) {
      const candidate=new ethers.JsonRpcProvider(url,137);
      try {
        const network=await candidate.getNetwork();
        if(network.chainId===CHAIN_ID) {
          readProvider=candidate;
          readContract=new ethers.Contract(STAKE_ADDRESS,ABI,readProvider);
          return;
        }
      } catch(error) { lastError=error; }
    }
    if(walletProvider) {
      readProvider=walletProvider;
      readContract=new ethers.Contract(STAKE_ADDRESS,ABI,readProvider);
      return;
    }
    throw lastError || new Error("Polygon read provider is unavailable.");
  }

  async function connectWallet() {
    if(!window.ethereum) throw new Error("Open NAVAA in your wallet's DApp browser.");
    if(!window.ethers) throw new Error("Ethers.js did not load.");
    walletProvider=new ethers.BrowserProvider(window.ethereum,"any");
    const accounts=await window.ethereum.request({method:"eth_accounts"});
    if(!accounts || !accounts.length) {
      account=null; signer=null; writeContract=null;
      return false;
    }
    const network=await walletProvider.getNetwork();
    if(network.chainId!==CHAIN_ID) throw new Error("Please switch your wallet to Polygon Mainnet.");
    account=ethers.getAddress(accounts[0]);
    signer=await walletProvider.getSigner();
    writeContract=new ethers.Contract(STAKE_ADDRESS,ABI,signer);
    await setupReadProvider();
    return true;
  }

  async function loadEvents() {
    const latest=await readProvider.getBlockNumber();
    const from=Math.max(0,latest-SCAN_WINDOW);
    const addressTopic=ethers.zeroPadValue(account,32).toLowerCase();
    const events=[];
    // Both events index the wallet in topic 1, so fetch them in one log query.
    for(let start=from;start<=latest;start+=CHUNK_SIZE) {
      const end=Math.min(start+CHUNK_SIZE-1,latest);
      const logs=await readProvider.getLogs({
        address:STAKE_ADDRESS,
        fromBlock:start,
        toBlock:end,
        topics:[[STAKED_TOPIC,WITHDRAW_TOPIC],addressTopic]
      });
      for(const log of logs) {
        const parsed=iface.parseLog(log);
        if(parsed) events.push({parsed,blockNumber:log.blockNumber,transactionHash:log.transactionHash});
      }
    }
    const stakes=events.filter(x=>x.parsed.name==="Staked");
    const withdrawals=events.filter(x=>x.parsed.name==="ReferralWithdrawn");
    return {latest,from,stakes,withdrawals};
  }

  function renderReferrals(events) {
    const body=$("referListBody"); if(!body) return;
    body.replaceChildren();
    const firstByWallet=new Map();
    for(const item of events) {
      const who=String(item.parsed.args.user).toLowerCase();
      if(!firstByWallet.has(who)) firstByWallet.set(who,item);
    }
    const rows=[...firstByWallet.values()].sort((a,b)=>b.blockNumber-a.blockNumber);
    if(!rows.length) { emptyTable("No referred first stakes found in the scanned block range."); return; }
    for(const item of rows) {
      const a=item.parsed.args,row=make("tr");
      row.append(make("td","",short(a.user)),make("td","",format(a.amount)+" NAVAA"),make("td","",format(a.referralReward)+" NAVAA"));
      const txCell=make("td"),link=make("a","","View transaction");
      link.href=txUrl(item.transactionHash); link.target="_blank"; link.rel="noopener noreferrer";
      txCell.appendChild(link); row.appendChild(txCell); body.appendChild(row);
    }
  }

  function renderHistory(stakes,withdrawals) {
    const box=$("referHistoryList"); if(!box) return;
    const rows=[
      ...stakes.map(x=>({label:"Referral reward generated",value:x.parsed.args.referralReward,block:x.blockNumber,hash:x.transactionHash})),
      ...withdrawals.map(x=>({label:"Referral reward withdrawn",value:x.parsed.args.net,block:x.blockNumber,hash:x.transactionHash}))
    ].sort((a,b)=>b.block-a.block).slice(0,30);
    box.replaceChildren();
    if(!rows.length) { box.appendChild(make("div","refer-empty","No referral transactions found in the scanned block range.")); return; }
    for(const item of rows) {
      const row=make("div","refer-history-item"),left=make("div"),right=make("div","refer-history-amount",format(item.value)+" NAVAA");
      left.append(make("strong","",item.label),make("small","","Block "+item.block+" · "+short(item.hash)));
      const small=make("small"),link=make("a","","View");
      link.href=txUrl(item.hash); link.target="_blank"; link.rel="noopener noreferrer";
      small.appendChild(link); right.appendChild(small); row.append(left,right); box.appendChild(row);
    }
  }

  async function refresh() {
    if(refreshRunning || !account || !readContract) return;
    refreshRunning=true;
    try {
      // This is the authoritative claimable amount from the deployed contract.
      const balance=await readContract.referralBalance(account);
      setText("referAvailable",format(balance));
      setText("referClaimable",format(balance)+" NAVAA");
      const withdrawBtn=$("referWithdrawBtn");
      if(withdrawBtn) withdrawBtn.disabled=balance===0n || busy;
      status("Available referral balance loaded from the staking contract.");

      try {
        const events=await loadEvents();
        const total=events.stakes.reduce((sum,x)=>sum+BigInt(x.parsed.args.referralReward),0n);
        const withdrawn=events.withdrawals.reduce((sum,x)=>sum+BigInt(x.parsed.args.net),0n);
        const unique=new Set(events.stakes.map(x=>String(x.parsed.args.user).toLowerCase()));
        setText("referLifetimeEarned",format(total)+" NAVAA");
        setText("referTotalCount",String(unique.size));
        setText("referWithdrawn",format(withdrawn));
        renderReferrals(events.stakes);
        renderHistory(events.stakes,events.withdrawals);
        setText("referScanNote","Scanned Polygon blocks "+events.from.toLocaleString()+"–"+events.latest.toLocaleString()+". Activity before this range is not included.");
        status("Referral balance and event history updated from Polygon.");
      } catch(error) {
        console.error("NAVAA referral event scan failed:",error);
        setText("referLifetimeEarned","History unavailable");
        setText("referTotalCount","—");
        setText("referWithdrawn","History unavailable");
        emptyTable("Polygon RPC could not load referral events. Your available balance above is still read directly from the contract.");
        const box=$("referHistoryList");
        if(box) box.replaceChildren(make("div","refer-empty","Referral history is temporarily unavailable."));
        setText("referScanNote","Event history could not be loaded. Available rewards remain independently readable from the contract.");
        status("Available balance loaded; event history RPC failed. See browser console for details.",true);
      }
    } catch(error) {
      console.error("NAVAA referral contract read failed:",error);
      setText("referAvailable","Read error");
      setText("referClaimable","Read error");
      const btn=$("referWithdrawBtn"); if(btn) btn.disabled=true;
      status(error?.shortMessage||error?.reason||error?.message||"Could not read referral balance from Polygon.",true);
    } finally {
      refreshRunning=false;
    }
  }

  async function withdraw() {
    if(busy || !account || !writeContract) return;
    busy=true;
    const btn=$("referWithdrawBtn"); if(btn) btn.disabled=true;
    try {
      const balance=await readContract.referralBalance(account);
      if(balance===0n) throw new Error("No referral rewards are available to withdraw.");
      status("Confirm referral reward withdrawal in your wallet.");
      const tx=await writeContract.withdrawReferralReward(balance);
      status("Withdrawal submitted. Waiting for Polygon confirmation...");
      await tx.wait();
      status("Withdrawal confirmed. Updating referral balance.");
      await refresh();
    } catch(error) {
      console.error("NAVAA referral withdrawal failed:",error);
      status(error?.shortMessage||error?.reason||error?.message||"Referral withdrawal failed.",true);
    } finally {
      busy=false;
      if(account) await refresh();
    }
  }

  async function copyLink() {
    const value=linkValue(); if(!value) return;
    try {
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const input=$("referLinkInput"); input?.focus(); input?.select();
        if(!document.execCommand("copy")) throw new Error("Copy is unavailable.");
      }
      setText("referLinkStatus","Referral link copied successfully.");
    } catch(error) { setText("referLinkStatus",error.message||"Could not copy referral link."); }
  }

  function shareLink() {
    const url=linkValue(); if(!url) return;
    const text="Join me on NAVAA. Use my referral link to get started: "+url;
    if(typeof navigator.share==="function") {
      navigator.share({title:"Join NAVAA",text,url}).then(
        ()=>setText("referLinkStatus","Share completed."),
        error=>{ if(error?.name!=="AbortError") setText("referLinkStatus","Sharing was cancelled or unavailable."); }
      );
      return;
    }
    const shareUrl="https://wa.me/?text="+encodeURIComponent(text);
    const opened=window.open(shareUrl,"_blank","noopener,noreferrer");
    if(opened) setText("referLinkStatus","WhatsApp opened. Choose the contact or group to share with.");
    else setText("referLinkStatus","Pop-up blocked. Copy the link and share it manually.");
  }

  function bind() {
    $("referCopyBtn")?.addEventListener("click",copyLink);
    $("referShareBtn")?.addEventListener("click",shareLink);
    $("referWithdrawBtn")?.addEventListener("click",withdraw);
    $("connectBtn")?.addEventListener("click",async()=>{
      for(let i=0;i<30;i++) {
        try {
          if(await connectWallet()) { updateLink(); await refresh(); return; }
        } catch(error) { status(error.message||"Wallet connection failed.",true); return; }
        await new Promise(resolve=>setTimeout(resolve,400));
      }
      status("Wallet connection not detected. Please connect again.",true);
    });
    if(window.ethereum?.on) {
      window.ethereum.on("accountsChanged",async()=>{
        account=null; signer=null; writeContract=null;
        try {
          if(await connectWallet()) { updateLink(); await refresh(); }
          else reset();
        } catch(error) { reset(); status(error.message||"Wallet account changed.",true); }
      });
      window.ethereum.on("chainChanged",()=>location.reload());
    }
  }

  async function init() {
    bind(); reset();
    try {
      if(await connectWallet()) { updateLink(); await refresh(); }
    } catch(error) {
      status(error.message||"Referral dashboard could not connect to Polygon.",true);
    }
    if(refreshTimer) clearInterval(refreshTimer);
    refreshTimer=setInterval(()=>{
      if(account && $("pageRefer")?.classList.contains("active") && !busy) refresh();
    },30000);
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
