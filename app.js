(() => {
  'use strict';

  const CFG = window.RCH_CONFIG || {};
  const app = document.getElementById('app');
  const LOGO = '/russell-court.png';
  const SECURITY_IDLE_MS = 60_000;
  const POST_ACTION_LOGOUT_SECONDS = 7;

  let sb = null;
  let session = null;
  let profile = null;
  let profiles = {};
  let entries = [];
  let registry = [];
  let pin = '';
  let securityIdleTimer = null;
  let logoutCountdownTimer = null;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nowIso = () => new Date().toISOString();
  const dublinDate = (v = new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Dublin'}).format(new Date(v));
  const fmt = (v, onlyTime=false) => {
    if (!v) return '—';
    const opts = onlyTime
      ? {hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Europe/Dublin'}
      : {dateStyle:'short',timeStyle:'short',hour12:false,timeZone:'Europe/Dublin'};
    return new Intl.DateTimeFormat('en-IE', opts).format(new Date(v));
  };
  const officerName = (id) => profiles[id]?.full_name || '—';
  const setHtml = (html) => { app.innerHTML = html; };

  function brand() {
    return `<div class="brand"><img src="${LOGO}" alt="The Russell Court Dublin"><div class="brand-copy"><b>RCH CAR PARK LOG</b><small>THE RUSSELL COURT DUBLIN</small></div></div>`;
  }

  function setupError() {
    setHtml(`<div class="login-shell"><div class="login-top">${brand()}</div><section class="pin-card"><div class="role-badge">SYSTEM SETUP</div><h1>Configuration required</h1><p>The new Supabase project has not been linked yet.</p><div class="msg err">Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in config.js.</div></section></div>`);
  }

  function initClient() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_PUBLISHABLE_KEY || !window.supabase) return false;
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return true;
  }

  function loginScreen(message='') {
    clearSecurityTimers();
    session = null; profile = null; profiles = {}; entries = []; registry = []; pin = '';
    setHtml(`
      <div class="login-shell">
        <div class="login-top">${brand()}<button class="secondary-link" id="openManagement">Administrator / Manager</button></div>
        <section class="pin-card">
          <div class="role-badge">◆ SECURITY OFFICER</div>
          <h1>Enter your 4-digit PIN</h1>
          <p>Each action is recorded under the officer who signs in.</p>
          <div class="pin-dots" id="pinDots"></div>
          <div class="keypad" id="keypad"></div>
          <button class="btn btn-primary btn-wide" id="pinLogin" style="margin-top:16px">LOGIN</button>
          <div id="pinMsg">${message ? `<div class="msg ok">${esc(message)}</div>` : ''}</div>
          <div class="subtle" style="margin-top:10px">Session closes automatically after each completed entry/exit.</div>
        </section>
      </div>
      <div class="modal-bg hidden" id="managementModal">
        <div class="modal">
          <div class="modal-head"><div><h2>Management access</h2><div class="subtle">Administrator or Manager</div></div><button class="btn btn-light" id="closeManagement">✕</button></div>
          <label class="field">Email<input id="mgEmail" type="email" autocomplete="username"></label>
          <label class="field">Password<input id="mgPassword" type="password" autocomplete="current-password"></label>
          <button class="btn btn-primary btn-wide" id="managementLogin">SIGN IN</button>
          <div id="mgMsg"></div>
          <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
            <button class="secondary-link" id="openFirstSetup" style="color:var(--blue);padding:0">First-time Administrator setup</button>
          </div>
          <div class="hidden" id="firstSetupBox" style="margin-top:14px">
            <div class="msg">Initial setup is restricted to <b>cobratreinamentos@gmail.com</b>.</div>
            <label class="field">Administrator email<input id="setupEmail" type="email" value="cobratreinamentos@gmail.com" readonly></label>
            <label class="field">Create password<input id="setupPassword" type="password" minlength="8" autocomplete="new-password"></label>
            <label class="field">Confirm password<input id="setupPassword2" type="password" minlength="8" autocomplete="new-password"></label>
            <button class="btn btn-green btn-wide" id="createFirstAdmin">CREATE ADMINISTRATOR</button>
            <div id="setupMsg"></div>
          </div>
        </div>
      </div>`);

    renderPin();
    document.getElementById('openManagement').onclick = () => document.getElementById('managementModal').classList.remove('hidden');
    document.getElementById('closeManagement').onclick = () => document.getElementById('managementModal').classList.add('hidden');
    document.getElementById('pinLogin').onclick = securityPinLogin;
    document.getElementById('managementLogin').onclick = managementLogin;
    document.getElementById('openFirstSetup').onclick = () => document.getElementById('firstSetupBox').classList.toggle('hidden');
    document.getElementById('createFirstAdmin').onclick = firstAdminSetup;
  }

  function renderPin() {
    const dots = document.getElementById('pinDots');
    const keypad = document.getElementById('keypad');
    if (!dots || !keypad) return;
    dots.innerHTML = [0,1,2,3].map(i => `<div class="pin-dot ${i < pin.length ? 'on' : ''}">${i < pin.length ? '•' : ''}</div>`).join('');
    keypad.innerHTML = [1,2,3,4,5,6,7,8,9,'⌫',0,'×'].map(k => `<button class="key" data-key="${k}">${k}</button>`).join('');
    keypad.querySelectorAll('button').forEach(b => b.onclick = () => {
      const k = b.dataset.key;
      if (k === '⌫') pin = pin.slice(0,-1);
      else if (k === '×') pin = '';
      else if (pin.length < 4) pin += k;
      renderPin();
      if (pin.length === 4) document.getElementById('pinLogin').focus();
    });
  }

  function inlineMsg(id, text, error=false, ok=false) {
    const el = document.getElementById(id); if (!el) return;
    el.innerHTML = text ? `<div class="msg ${error?'err':''} ${ok?'ok':''}">${esc(text)}</div>` : '';
  }

  async function securityPinLogin() {
    if (pin.length !== 4) return inlineMsg('pinMsg','Enter all 4 digits.',true);
    inlineMsg('pinMsg','Checking PIN…');
    try {
      const { data, error } = await sb.functions.invoke('security-pin-login',{ body:{ pin } });
      if (error) throw error;
      if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || 'PIN not accepted.');
      const set = await sb.auth.setSession({ access_token:data.access_token, refresh_token:data.refresh_token });
      if (set.error) throw set.error;
      session = set.data.session;
      await enterAuthenticated();
    } catch (e) {
      pin = ''; renderPin(); inlineMsg('pinMsg', e.message || 'Unable to sign in.', true);
    }
  }

  async function managementLogin() {
    const email = document.getElementById('mgEmail').value.trim();
    const password = document.getElementById('mgPassword').value;
    inlineMsg('mgMsg','Signing in…');
    const { data, error } = await sb.auth.signInWithPassword({email,password});
    if (error) return inlineMsg('mgMsg',error.message,true);
    session = data.session;
    try { await enterAuthenticated(); } catch (e) { inlineMsg('mgMsg',e.message,true); }
  }

  async function firstAdminSetup() {
    const email = 'cobratreinamentos@gmail.com';
    const password = document.getElementById('setupPassword').value;
    const confirmPassword = document.getElementById('setupPassword2').value;
    if (password.length < 8) return inlineMsg('setupMsg','Password must contain at least 8 characters.',true);
    if (password !== confirmPassword) return inlineMsg('setupMsg','Passwords do not match.',true);
    inlineMsg('setupMsg','Creating Administrator…');
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options:{
        emailRedirectTo: window.location.origin,
        data:{ full_name:'RCH Administrator' }
      }
    });
    if (error) return inlineMsg('setupMsg',error.message,true);
    if (data?.session) {
      session = data.session;
      try { await enterAuthenticated(); return; } catch(e) { return inlineMsg('setupMsg',e.message,true); }
    }
    inlineMsg('setupMsg','Administrator created. Check cobratreinamentos@gmail.com and confirm the email, then return here and sign in.',false,true);
    document.getElementById('setupPassword').value='';
    document.getElementById('setupPassword2').value='';
  }

  async function loadData() {
    const {data:p,error:pe} = await sb.from('profiles').select('*').eq('id',session.user.id).single();
    if (pe) throw pe;
    profile = p;
    const [ps, es, rg] = await Promise.all([
      sb.from('profiles').select('*').order('full_name'),
      sb.from('car_park_entries').select('*').order('entry_time',{ascending:false}).limit(2500),
      sb.from('people_vehicles').select('*').order('full_name')
    ]);
    if (ps.error) throw ps.error; if (es.error) throw es.error; if (rg.error) throw rg.error;
    profiles = Object.fromEntries((ps.data||[]).map(x=>[x.id,x]));
    entries = es.data || [];
    registry = rg.data || [];
  }

  async function refreshData() { await loadData(); }

  async function enterAuthenticated() {
    await loadData();
    if (profile.role === 'security') {
      renderSecurityHome();
      startSecurityIdleTimer();
    } else if (profile.role === 'manager') renderManager();
    else if (profile.role === 'admin') renderAdmin('dashboard');
    else throw new Error('This account has no valid role.');
  }

  function securityShell(content) {
    setHtml(`<header class="topbar">${brand()}<button class="secondary-link" id="logoutBtn">Logout</button></header><main class="wrap"><div class="welcome"><small>Logged in as</small><strong>${esc(profile.full_name)}</strong><small>Security Officer · Auto logout enabled</small></div><div id="securityScreen">${content}</div></main>`);
    document.getElementById('logoutBtn').onclick = () => logoutNow();
    installSecurityActivityListeners();
  }

  function renderSecurityHome() {
    const inside = entries.filter(e=>!e.exit_time);
    securityShell(`
      <button class="action-card primary" id="vehicleInAction"><div class="action-icon">＋</div><div><b>VEHICLE IN</b><span>Register a vehicle entering</span></div></button>
      <button class="action-card" id="currentlyInAction"><div class="action-icon">🚗</div><div><b>CURRENTLY IN</b><span>Select a vehicle here to register its exit</span></div><div class="count">${inside.length}</div></button>`);
    document.getElementById('vehicleInAction').onclick = renderVehicleIn;
    document.getElementById('currentlyInAction').onclick = renderCurrentlyIn;
  }

  function renderVehicleIn() {
    securityShell(`<div class="card"><button class="btn btn-light" id="backSec">← Back</button><h2>Vehicle In</h2>
      <label class="field">Search frequent person / vehicle<input id="registrySearch" autocomplete="off" placeholder="Name or registration"></label><div id="suggestions" class="suggestions"></div>
      <div class="grid">
        <label class="field">Name *<input id="driverName"></label>
        <label class="field">Department *<input id="department"></label>
        <label class="field">Vehicle make<input id="vehicleMake"></label>
        <label class="field">Vehicle model<input id="vehicleModel"></label>
        <label class="field full">Registration *<input id="registration" autocapitalize="characters"></label>
      </div>
      <button class="btn btn-primary btn-wide" id="saveVehicleIn">CONFIRM VEHICLE IN</button><div id="vehicleMsg"></div></div>`);
    document.getElementById('backSec').onclick = renderSecurityHome;
    document.getElementById('registrySearch').oninput = renderRegistrySuggestions;
    document.getElementById('saveVehicleIn').onclick = saveVehicleIn;
  }

  function renderRegistrySuggestions() {
    const q = document.getElementById('registrySearch').value.trim().toLowerCase();
    const box = document.getElementById('suggestions');
    if (q.length < 2) { box.innerHTML=''; return; }
    const matches = registry.filter(r => r.active && [r.full_name,r.registration,r.department,r.vehicle_make,r.vehicle_model].some(v=>(v||'').toLowerCase().includes(q))).slice(0,6);
    box.innerHTML = matches.map(r => `<button class="suggestion" data-id="${r.id}"><b>${esc(r.full_name)} · ${esc(r.registration)}</b><div class="subtle">${esc(r.department||'')} · ${esc([r.vehicle_make,r.vehicle_model].filter(Boolean).join(' '))}</div></button>`).join('');
    box.querySelectorAll('button').forEach(b => b.onclick = () => {
      const r = registry.find(x=>x.id===b.dataset.id); if (!r) return;
      document.getElementById('driverName').value=r.full_name||'';
      document.getElementById('department').value=r.department||'';
      document.getElementById('vehicleMake').value=r.vehicle_make||'';
      document.getElementById('vehicleModel').value=r.vehicle_model||'';
      document.getElementById('registration').value=r.registration||'';
      box.innerHTML='';
    });
  }

  async function saveVehicleIn() {
    const payload = {
      driver_name:document.getElementById('driverName').value.trim(),
      department:document.getElementById('department').value.trim(),
      vehicle_make:document.getElementById('vehicleMake').value.trim()||null,
      vehicle_model:document.getElementById('vehicleModel').value.trim()||null,
      registration:document.getElementById('registration').value.trim().toUpperCase(),
      entry_time:nowIso(), created_by:session.user.id
    };
    if (!payload.driver_name || !payload.department || !payload.registration) return inlineMsg('vehicleMsg','Name, department and registration are required.',true);
    inlineMsg('vehicleMsg','Saving…');
    const {error}=await sb.from('car_park_entries').insert(payload);
    if (error) return inlineMsg('vehicleMsg',error.message,true);
    await postActionLogout('Vehicle entry recorded successfully.');
  }

  function renderCurrentlyIn() {
    const inside = entries.filter(e=>!e.exit_time);
    securityShell(`<div class="card"><button class="btn btn-light" id="backSec">← Back</button><h2>Currently In (${inside.length})</h2>
      ${inside.length ? inside.map(e=>`<button class="vehicle-item" data-id="${e.id}"><div><div class="reg">${esc(e.registration)}</div><small>${esc(e.driver_name)} · ${esc(e.department||'')}</small><small>Entered ${fmt(e.entry_time,true)} by ${esc(officerName(e.created_by))}</small></div><div class="time">EXIT ›</div></button>`).join('') : '<div class="msg">No vehicles currently inside.</div>'}</div>`);
    document.getElementById('backSec').onclick = renderSecurityHome;
    document.querySelectorAll('.vehicle-item[data-id]').forEach(b=>b.onclick=()=>renderVehicleOut(b.dataset.id));
  }

  function renderVehicleOut(id) {
    const e = entries.find(x=>x.id===id); if (!e) return renderCurrentlyIn();
    securityShell(`<div class="card"><button class="btn btn-light" id="backInside">← Back</button><h2>Vehicle Out</h2>
      <div class="vehicle-item"><div><div class="reg">${esc(e.registration)}</div><small>${esc(e.driver_name)} · ${esc(e.department||'')}</small><small>Entered ${fmt(e.entry_time,true)} by ${esc(officerName(e.created_by))}</small></div></div>
      <div class="confirmation"><div style="font-size:13px;color:var(--muted)">Confirm this vehicle is leaving now</div><div style="font-size:36px;color:var(--green);font-weight:900;margin-top:8px">${fmt(nowIso(),true)}</div></div>
      <button class="btn btn-green btn-wide" id="confirmVehicleOut">CONFIRM VEHICLE OUT</button><div id="vehicleOutMsg"></div></div>`);
    document.getElementById('backInside').onclick = renderCurrentlyIn;
    document.getElementById('confirmVehicleOut').onclick = () => saveVehicleOut(id);
  }

  async function saveVehicleOut(id) {
    inlineMsg('vehicleOutMsg','Saving…');
    const {error}=await sb.from('car_park_entries').update({exit_time:nowIso(),exit_by:session.user.id}).eq('id',id);
    if (error) return inlineMsg('vehicleOutMsg',error.message,true);
    await postActionLogout('Vehicle exit recorded successfully.');
  }

  async function postActionLogout(message) {
    clearSecurityTimers();
    let remaining = POST_ACTION_LOGOUT_SECONDS;
    securityShell(`<div class="card"><div class="confirmation"><div class="check">✓</div><h2>${esc(message)}</h2><p class="subtle">The action is linked to ${esc(profile.full_name)}.</p><div class="countdown" id="logoutCountdown">Logging out in ${remaining} seconds…</div></div></div>`);
    logoutCountdownTimer = setInterval(async()=>{
      remaining -= 1;
      const el=document.getElementById('logoutCountdown'); if(el) el.textContent=`Logging out in ${Math.max(remaining,0)} seconds…`;
      if(remaining<=0){ clearInterval(logoutCountdownTimer); logoutCountdownTimer=null; await logoutNow('Ready for the next security officer.'); }
    },1000);
  }

  function installSecurityActivityListeners() {
    ['pointerdown','keydown','input','touchstart'].forEach(evt => document.addEventListener(evt,securityActivity,{passive:true,once:true}));
  }
  function securityActivity(){ if(profile?.role==='security' && !logoutCountdownTimer) startSecurityIdleTimer(); }
  function startSecurityIdleTimer(){
    if(profile?.role!=='security' || logoutCountdownTimer) return;
    if(securityIdleTimer) clearTimeout(securityIdleTimer);
    securityIdleTimer=setTimeout(()=>logoutNow('Session closed after 60 seconds of inactivity.'),SECURITY_IDLE_MS);
    installSecurityActivityListeners();
  }
  function clearSecurityTimers(){ if(securityIdleTimer){clearTimeout(securityIdleTimer);securityIdleTimer=null;} if(logoutCountdownTimer){clearInterval(logoutCountdownTimer);logoutCountdownTimer=null;} }

  async function logoutNow(message='') {
    clearSecurityTimers();
    try { if(sb) await sb.auth.signOut(); } catch(_) {}
    loginScreen(message);
  }

  function rowsForDate(date) { return entries.filter(e=>dublinDate(e.entry_time)===date); }
  function reportHtml(date) {
    const rows=rowsForDate(date);
    return `<div class="report"><h2>RCH CAR PARK LOG</h2><div style="text-align:center;font-size:12px;margin-bottom:10px">The Russell Court Dublin · ${esc(date)} · ${rows.length} records</div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Department</th><th>Vehicle / Reg</th><th>Time In</th><th>Time Out</th><th>Entry By</th><th>Exit By</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${esc(e.driver_name)}</td><td>${esc(e.department||'')}</td><td>${esc([e.vehicle_make,e.vehicle_model].filter(Boolean).join(' '))}<br><b>${esc(e.registration)}</b></td><td>${fmt(e.entry_time,true)}</td><td>${fmt(e.exit_time,true)}</td><td>${esc(officerName(e.created_by))}</td><td>${esc(officerName(e.exit_by))}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  function managementTop(title, subtitle='') { return `<header class="topbar">${brand()}<button class="secondary-link" id="logoutBtn">Logout</button></header><main class="wrap"><div class="welcome"><small>${esc(subtitle||'Management access')}</small><strong>${esc(profile.full_name)}</strong><small>${esc(title)}</small></div><div id="managerBody"></div></main>`; }

  function renderManager() {
    setHtml(managementTop('Manager','Reports and parking records'));
    document.getElementById('logoutBtn').onclick=()=>logoutNow();
    const date=dublinDate();
    document.getElementById('managerBody').innerHTML=`<div class="card no-print"><label class="field">Report date<input id="managerDate" type="date" value="${date}"></label><button class="btn btn-primary" id="managerGenerate">VIEW REPORT</button> <button class="btn btn-light" id="managerPrint">PRINT / SAVE PDF</button></div><div id="managerReport" style="margin-top:12px">${reportHtml(date)}</div>`;
    document.getElementById('managerGenerate').onclick=()=>document.getElementById('managerReport').innerHTML=reportHtml(document.getElementById('managerDate').value);
    document.getElementById('managerPrint').onclick=()=>window.print();
  }

  function adminLayout(active, content) {
    setHtml(`<div class="admin-shell"><aside class="sidebar">${brand()}<div class="admin-user"><small>Administrator</small><br><b>${esc(profile.full_name)}</b></div><nav class="admin-menu" id="adminMenu">
      ${[['dashboard','▦ Dashboard'],['users','♟ Users'],['people','♙ People & Vehicles'],['records','▤ Parking Records'],['reports','▣ PDF Reports'],['audit','⌁ Audit Log']].map(([p,l])=>`<button data-page="${p}" class="${p===active?'active':''}">${l}</button>`).join('')}
      <button id="adminLogout" style="color:#ffaaaa">↪ Logout</button></nav></aside><main class="admin-main" id="adminMain">${content}</main></div>`);
    document.querySelectorAll('#adminMenu button[data-page]').forEach(b=>b.onclick=()=>renderAdmin(b.dataset.page));
    document.getElementById('adminLogout').onclick=()=>logoutNow();
  }

  function renderAdmin(page) {
    if(page==='dashboard') return adminDashboard();
    if(page==='users') return adminUsers();
    if(page==='people') return adminPeople();
    if(page==='records') return adminRecords();
    if(page==='reports') return adminReports();
    if(page==='audit') return adminAudit();
  }

  function adminDashboard() {
    const users=Object.values(profiles), todayRows=rowsForDate(dublinDate()), inside=entries.filter(e=>!e.exit_time);
    adminLayout('dashboard',`<div class="page-head"><div><h1>Administrator Dashboard</h1><div class="subtle">RCH Car Park Log overview</div></div></div><div class="stats"><div class="stat"><b>${users.filter(x=>x.role==='security').length}</b><br>Security Officers</div><div class="stat"><b>${users.filter(x=>x.role==='manager').length}</b><br>Managers</div><div class="stat"><b>${registry.filter(x=>x.active).length}</b><br>Frequent Vehicles</div><div class="stat"><b>${todayRows.length}</b><br>Records Today</div></div><div class="panel"><h2>Currently In (${inside.length})</h2>${inside.map(e=>`<div class="vehicle-item"><div><div class="reg">${esc(e.registration)}</div><small>${esc(e.driver_name)} · ${esc(e.department||'')}</small></div><div class="time">${fmt(e.entry_time,true)}</div></div>`).join('')||'<div class="subtle">No vehicles currently inside.</div>'}</div>`);
  }

  function adminUsers() {
    adminLayout('users',`<div class="page-head"><div><h1>Users</h1><div class="subtle">Create Security, Manager or Administrator access</div></div></div><div class="panel"><div class="grid"><label class="field">Full name *<input id="newUserName"></label><label class="field">Role<select id="newUserRole"><option value="security">Security Officer</option><option value="manager">Manager</option><option value="admin">Administrator</option></select></label><div class="full" id="roleFields"></div></div><button class="btn btn-primary" id="createUserBtn">CREATE USER</button><div id="userMsg"></div></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Access</th></tr></thead><tbody>${Object.values(profiles).map(p=>`<tr><td><b>${esc(p.full_name)}</b></td><td>${esc(p.role)}</td><td>${p.role==='security'?'4-digit PIN':'Email + password'}</td></tr>`).join('')}</tbody></table></div></div>`);
    const role=document.getElementById('newUserRole');
    const draw=()=>document.getElementById('roleFields').innerHTML=role.value==='security'?`<label class="field">4-digit PIN *<input id="newUserPin" maxlength="4" inputmode="numeric" pattern="[0-9]*"></label>`:`<div class="grid"><label class="field">Email *<input id="newUserEmail" type="email"></label><label class="field">Password *<input id="newUserPassword" type="password" minlength="8"></label></div>`;
    role.onchange=draw;draw();document.getElementById('createUserBtn').onclick=createAdminUser;
  }

  async function createAdminUser(){
    const role=document.getElementById('newUserRole').value;
    const body={full_name:document.getElementById('newUserName').value.trim(),role};
    if(role==='security') body.pin=document.getElementById('newUserPin').value.trim();
    else {body.email=document.getElementById('newUserEmail').value.trim();body.password=document.getElementById('newUserPassword').value;}
    inlineMsg('userMsg','Creating…');
    const {data,error}=await sb.functions.invoke('admin-create-user',{body});
    if(error||data?.error) return inlineMsg('userMsg',data?.error||error.message,true);
    await refreshData(); adminUsers();
  }

  function adminPeople(){
    adminLayout('people',`<div class="page-head"><div><h1>People & Vehicles</h1><div class="subtle">Frequent drivers for faster Security entry</div></div></div><div class="panel"><div class="grid"><label class="field">Full name *<input id="personName"></label><label class="field">Department *<input id="personDepartment"></label><label class="field">Make<input id="personMake"></label><label class="field">Model<input id="personModel"></label><label class="field full">Registration *<input id="personReg"></label></div><button class="btn btn-primary" id="savePerson">SAVE</button><div id="personMsg"></div></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Department</th><th>Vehicle</th><th>Registration</th><th>Status</th><th></th></tr></thead><tbody>${registry.map(r=>`<tr><td><b>${esc(r.full_name)}</b></td><td>${esc(r.department||'')}</td><td>${esc([r.vehicle_make,r.vehicle_model].filter(Boolean).join(' '))}</td><td>${esc(r.registration)}</td><td><span class="pill ${r.active?'':'gray'}">${r.active?'Active':'Inactive'}</span></td><td><button class="btn btn-light toggle-person" data-id="${r.id}" data-active="${r.active}">${r.active?'Disable':'Enable'}</button></td></tr>`).join('')}</tbody></table></div></div>`);
    document.getElementById('savePerson').onclick=savePerson;
    document.querySelectorAll('.toggle-person').forEach(b=>b.onclick=async()=>{const {error}=await sb.from('people_vehicles').update({active:b.dataset.active!=='true'}).eq('id',b.dataset.id);if(error)return alert(error.message);await refreshData();adminPeople();});
  }

  async function savePerson(){
    const p={full_name:document.getElementById('personName').value.trim(),department:document.getElementById('personDepartment').value.trim(),vehicle_make:document.getElementById('personMake').value.trim()||null,vehicle_model:document.getElementById('personModel').value.trim()||null,registration:document.getElementById('personReg').value.trim().toUpperCase()};
    if(!p.full_name||!p.department||!p.registration)return inlineMsg('personMsg','Name, department and registration are required.',true);
    const {error}=await sb.from('people_vehicles').insert(p);if(error)return inlineMsg('personMsg',error.message,true);await refreshData();adminPeople();
  }

  function adminRecords(){
    adminLayout('records',`<div class="page-head"><div><h1>Parking Records</h1><div class="subtle">Administrator corrections and audit-protected records</div></div></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Department</th><th>Vehicle / Reg</th><th>Time In</th><th>Time Out</th><th>Entry By</th><th>Exit By</th><th></th></tr></thead><tbody>${entries.map(e=>`<tr><td>${esc(e.driver_name)}</td><td>${esc(e.department||'')}</td><td>${esc([e.vehicle_make,e.vehicle_model].filter(Boolean).join(' '))}<br><b>${esc(e.registration)}</b></td><td>${fmt(e.entry_time)}</td><td>${fmt(e.exit_time)}</td><td>${esc(officerName(e.created_by))}</td><td>${esc(officerName(e.exit_by))}</td><td><button class="btn btn-danger delete-record" data-id="${e.id}">Delete</button></td></tr>`).join('')}</tbody></table></div></div>`);
    document.querySelectorAll('.delete-record').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this parking record? This action will be retained in the audit log.'))return;const {error}=await sb.from('car_park_entries').delete().eq('id',b.dataset.id);if(error)return alert(error.message);await refreshData();adminRecords();});
  }

  function adminReports(){const date=dublinDate();adminLayout('reports',`<div class="page-head"><div><h1>PDF Reports</h1></div></div><div class="panel no-print"><label class="field">Date<input id="adminReportDate" type="date" value="${date}"></label><button class="btn btn-primary" id="generateReport">GENERATE</button> <button class="btn btn-light" id="printReport">PRINT / SAVE PDF</button></div><div id="adminReport">${reportHtml(date)}</div>`);document.getElementById('generateReport').onclick=()=>document.getElementById('adminReport').innerHTML=reportHtml(document.getElementById('adminReportDate').value);document.getElementById('printReport').onclick=()=>window.print();}

  async function adminAudit(){
    const {data,error}=await sb.from('audit_log').select('*').order('changed_at',{ascending:false}).limit(300);
    if(error) return adminLayout('audit',`<div class="msg err">${esc(error.message)}</div>`);
    adminLayout('audit',`<div class="page-head"><div><h1>Audit Log</h1><div class="subtle">Database-level record of inserts, updates and deletes</div></div></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Changed By</th><th>Record</th></tr></thead><tbody>${(data||[]).map(a=>`<tr><td>${fmt(a.changed_at)}</td><td>${esc(a.action)}</td><td>${esc(officerName(a.changed_by)||'System')}</td><td>${esc(a.entry_id||'')}</td></tr>`).join('')}</tbody></table></div></div>`);
  }

  async function boot(){
    if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
    if(!initClient()) return setupError();
    // Security design requirement: every fresh app launch starts at the PIN screen.
    try { await sb.auth.signOut(); } catch(_) {}
    loginScreen();
  }

  boot();
})();
