/* =====================================================
   NAVAA REFER & EARN — POLYGON CONTRACT READS
   Uses existing deployed staking contract only.
===================================================== */
(() => {
  "use strict";
  if (window.NAVAA_REFER_INITIALIZED) return;
  window.NAVAA_REFER_INITIALIZED = true;

  const STAKE_ADDRESS = "0xE46E8b1AC4CDFAE9CF9d1D9B0BD6D1705CB5B8C9";
  const TOKEN_ADDRESS = "0x82dba663278ADF0c398c1795a31760c7a76CA932";
  const CHAIN_ID = 137n;
  const SCAN_WINDOW = 500000;
  const STAKE_ABI = [
    "function referralBalance(address user) view returns (uint256)",
    "function withdrawReferralReward(uint256 amount)",
    "function hasStaked(address user) view returns (bool)",
    "event Staked(address indexed user,uint256 indexed positionId,uint256 amount,address indexed referrer,uint256 referralReward)",
    "event ReferralWithdrawn(address indexed user,uint256 gross,uint256 fee,uint256 net)"
  ];

  const $ = id => document.getElementById(id);
  let provider = null, signer = null, staking = null, account = null;
  let decimals = 18, busy = false, refreshTimer = null, lastEvents = [];

  function setText(id, value) { const el=$(id); if(el) el.textContent=value; }
  function short(address) { return address ? address.slice(0,6)+"..."+address.slice(-4) : "—"; }
  function amount(raw, digits=4) {
    try { return Number(ethers.formatUnits(raw,decimals)).toLocaleString("en-US",{maximumFractionDigits:digits}); }
    catch { return "—"; }
  }
  function make(tag, cls, value) {
    const el=document.createElement(tag);
    if(cls) el.className=cls;
    if(value!==undefined) el.textContent=value;
    return el;
  }
  function explorerTx(hash) { return "https://polygonscan.com/tx/"+hash; }

  function setStatus(message,error=false) {
    const el=$("referStatus");
    if(!el) return;
    el.textContent=message;
    el.style.color=error?"#f6465d":"";
  }
  function setEmpty(id,message,cols=1) {
    const el=$(id); if(!el) return;
    el.replaceChildren();
    const row=make("tr");
    const cell=make("td","refer-empty",message);
    cell.colSpan=cols; row.appendChild(cell); el.appendChild(row);
  }
  function referralUrl() {
    return account ? location.origin+location.pathname+"?ref="+encodeURIComponent(account) : "";
  }
  function updateLink() {
    const input=$("referLinkInput"), copy=$("referCopyBtn"), share=$("referShareBtn");
    if(input) input.value=referralUrl();
    if(copy) copy.disabled=!account;
    if(share) share.disabled=!account;
    setText("referLinkStatus",account?"Share this link with friends.":"Connect wallet to get your referral link.");
  }
  function reset() {
    ["referLifetimeEarned","referTotalCount","referAvailable","referWithdrawn","referClaimable"].forEach(id=>setText(id,"—"));
    setEmpty("referListBody","Connect wallet to load referral activity.",4);
    const history=$("referHistoryList");
    if(history) history.replaceChildren(make("div","refer-empty","Connect wallet to load your referral history."));
    const note=$("referScanNote");
    if(note) note.textContent="Referral activity is read from Polygon staking events.";
    const btn=$("referWithdrawBtn"); if(btn) btn.disabled=true;
    updateLink();
    setStatus("Connect your wallet to view referral rewards.");
  }

  async function connectRead() {
    if(!window.ethereum || !window.ethers) return false;
    provider=new ethers.BrowserProvider(window.ethereum,"any");
    const accounts=await window.ethereum.request({method:"eth_accounts"});
    if(!accounts?.length) { account=null; signer=null; staking=null; return false; }
    const network=await provider.getNetwork();
    if(network.chainId!==CHAIN_ID) throw new Error("Please switch your wallet to Polygon Mainnet.");
    account=ethers.getAddress(accounts[0]);
    signer=await provider.getSigner();
    staking=new ethers.Contract(STAKE_ADDRESS,STAKE_ABI,signer);
    return true;
  }

  async function queryEventsInChunks(filter, from, latest) {
    const chunkSize = 5000;
    const ranges = [];
    for (let start = from; start <= latest; start += chunkSize) {
      ranges.push([start, Math.min(start + chunkSize - 1, latest)]);
    }

    const output = [];
    let cursor = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (cursor < ranges.length) {
        const index = cursor++;
        const [start, end] = ranges[index];
        const logs = await staking.queryFilter(filter, start, end);
        output.push(...logs);
      }
    });
    await Promise.all(workers);
    return output;
  }

  async function loadReferralEvents() {
    const latest = await provider.getBlockNumber();
    const from = Math.max(0, latest - SCAN_WINDOW);
    const stakeFilter = staking.filters.Staked(null, null, account);
    const withdrawFilter = staking.filters.ReferralWithdrawn(account);

    // Public Polygon RPC endpoints often reject large eth_getLogs ranges.
    // Scan in smaller batches so one oversized request cannot break the page.
    const [stakes, withdrawals] = await Promise.all([
      queryEventsInChunks(stakeFilter, from, latest),
      queryEventsInChunks(withdrawFilter, from, latest)
    ]);

    const unique = new Map();
    for (const ev of stakes) {
      const user = String(ev.args.user).toLowerCase();
      if (!unique.has(user)) unique.set(user, ev);
    }
    return { latest, from, stakes: [...unique.values()], withdrawals };
  }

  function renderReferrals(events) {
    const body=$("referListBody"); if(!body) return;
    body.replaceChildren();
    if(!events.length) {
      setEmpty("referListBody","No successful referrals found in the scanned block range.",4);
      return;
    }
    for(const ev of [...events].sort((a,b)=>b.blockNumber-a.blockNumber)) {
      const row=make("tr");
      const wallet=make("td", "", short(ev.args.user));
      const stake=make("td","",amount(ev.args.amount)+" NAVAA");
      const reward=make("td","",amount(ev.args.referralReward)+" NAVAA");
      const tx=make("td");
      const link=make("a","", "View transaction");
      link.href=explorerTx(ev.transactionHash); link.target="_blank"; link.rel="noopener noreferrer";
      tx.appendChild(link);
      row.append(wallet,stake,reward,tx);
      body.appendChild(row);
    }
  }

  function renderHistory(stakes,withdrawals) {
    const box=$("referHistoryList"); if(!box) return;
    const items=[
      ...stakes.map(ev=>({type:"Referral earned",amount:ev.args.referralReward,hash:ev.transactionHash,block:ev.blockNumber})),
      ...withdrawals.map(ev=>({type:"Referral withdrawn",amount:ev.args.net,hash:ev.transactionHash,block:ev.blockNumber}))
    ].sort((a,b)=>b.block-a.block).slice(0,30);
    box.replaceChildren();
    if(!items.length) { box.appendChild(make("div","refer-empty","No referral reward events found in the scanned block range.")); return; }
    for(const item of items) {
      const row=make("div","refer-history-item");
      const left=make("div");
      left.append(make("strong","",item.type),make("small","", "Block "+item.block+" · "+short(item.hash)));
      const right=make("div","refer-history-amount",amount(item.amount)+" NAVAA");
      const link=make("a","","View");
      link.href=explorerTx(item.hash); link.target="_blank"; link.rel="noopener noreferrer";
      right.appendChild(make("small",""));
      right.lastChild.appendChild(link);
      row.append(left,right); box.appendChild(row);
    }
  }

  async function refresh() {
    if (!account || !staking || !provider) { reset(); return; }

    decimals = 18;

    // Read the actual contract balance independently from event history.
    // If the RPC refuses log queries, the user's claimable balance must
    // still be visible and the withdrawal button must still work.
    let balance;
    try {
      balance = await staking.referralBalance(account);
      setText("referAvailable", amount(balance));
      setText("referClaimable", amount(balance) + " NAVAA");
      const btn = $("referWithdrawBtn");
      if (btn) btn.disabled = balance === 0n || busy;
      setStatus("On-chain referral balance loaded.");
    } catch (error) {
      console.warn("NAVAA referral balance read failed:", error);
      setText("referAvailable", "Read error");
      setText("referClaimable", "Read error");
      const btn = $("referWithdrawBtn");
      if (btn) btn.disabled = true;
      setStatus(error?.shortMessage || error?.reason || error?.message || "Could not read referral balance.", true);
      return;
    }

    try {
      const events = await loadReferralEvents();
      lastEvents = events.stakes;
      const earned = events.stakes.reduce((sum, ev) => sum + BigInt(ev.args.referralReward), 0n);
      const withdrawn = events.withdrawals.reduce((sum, ev) => sum + BigInt(ev.args.net), 0n);

      setText("referLifetimeEarned", amount(earned) + " NAVAA");
      setText("referTotalCount", String(events.stakes.length));
      setText("referWithdrawn", amount(withdrawn));
      renderReferrals(events.stakes);
      renderHistory(events.stakes, events.withdrawals);
      setText("referScanNote", "Showing matching events from Polygon blocks " + events.from.toLocaleString() + "–" + events.latest.toLocaleString() + ". Older referrals may not appear in this limited scan.");
      setStatus("Referral balance loaded from the contract. Referral history scan completed.");
    } catch (error) {
      console.warn("NAVAA referral event scan failed:", error);
      setText("referLifetimeEarned", "History unavailable");
      setText("referTotalCount", "—");
      setText("referWithdrawn", "—");
      setEmpty("referListBody", "Referral event scan failed. Your on-chain available balance above is still accurate.", 4);
      const history = $("referHistoryList");
      if (history) history.replaceChildren(make("div", "refer-empty", "Referral event history is temporarily unavailable."));
      setText("referScanNote", "The RPC could not return event history. The available reward balance is read directly from the staking contract.");
      setStatus("Your contract balance is loaded. Referral history is temporarily unavailable.", true);
    }
  }

  async function withdraw() {
    if(busy || !account || !staking) return;
    try {
      const balance=await staking.referralBalance(account);
      if(balance===0n) throw new Error("No referral rewards available to withdraw.");
      busy=true;
      const btn=$("referWithdrawBtn"); if(btn) btn.disabled=true;
      setStatus("Confirm the referral reward withdrawal in your wallet.");
      const tx=await staking.withdrawReferralReward(balance);
      setStatus("Withdrawal submitted. Waiting for Polygon confirmation...");
      await tx.wait();
      setStatus("Referral rewards withdrawn successfully. Refreshing your balance.");
      await refresh();
    } catch(error) {
      setStatus(error?.shortMessage||error?.reason||error?.message||"Referral withdrawal failed.",true);
    } finally {
      busy=false;
      const btn=$("referWithdrawBtn");
      if(btn) btn.disabled=!account;
      if(account) await refresh();
    }
  }

  async function copyLink() {
    const value=referralUrl(); if(!value) return;
    try {
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const input=$("referLinkInput"); input?.select();
        if(!document.execCommand("copy")) throw new Error("Copy is not available in this browser.");
      }
      setText("referLinkStatus","Referral link copied.");
    } catch(error) { setText("referLinkStatus",error.message||"Unable to copy link."); }
  }
  async function shareLink() {
    const url=referralUrl(); if(!url) return;
    try {
      if(navigator.share) await navigator.share({title:"Join NAVAA",text:"Join me on NAVAA and explore staking rewards.",url});
      else await copyLink();
    } catch(error) {
      if(error?.name!=="AbortError") setText("referLinkStatus","Sharing is unavailable. Copy the link instead.");
    }
  }

  function bind() {
    $("referCopyBtn")?.addEventListener("click",copyLink);
    $("referShareBtn")?.addEventListener("click",shareLink);
    $("referWithdrawBtn")?.addEventListener("click",withdraw);
    $("connectBtn")?.addEventListener("click",async()=>{
      for(let i=0;i<30;i++) {
        try {
          if(await connectRead()) { updateLink(); await refresh(); return; }
        } catch(error) { setStatus(error.message||"Wallet connection error.",true); return; }
        await new Promise(resolve=>setTimeout(resolve,500));
      }
    });
    if(window.ethereum?.on) {
      window.ethereum.on("accountsChanged",async()=>{
        account=null; signer=null; staking=null;
        try { if(await connectRead()) { updateLink(); await refresh(); } else reset(); }
        catch(error) { reset(); setStatus(error.message,true); }
      });
      window.ethereum.on("chainChanged",()=>location.reload());
    }
  }

  async function init() {
    bind(); reset();
    try { if(await connectRead()) { updateLink(); await refresh(); } }
    catch(error) { setStatus(error.message||"Wallet connection error.",true); }
    if(refreshTimer) clearInterval(refreshTimer);
    refreshTimer=setInterval(()=>{
      if(account && $("pageRefer")?.classList.contains("active") && !busy) refresh();
    },60000);
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
