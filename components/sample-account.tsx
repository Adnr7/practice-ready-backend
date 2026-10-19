"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LoginAtmosphere, LoginEqualizer } from "@/components/login-atmosphere";
import { Eye, EyeOff, LogOut, UserRound, Music2, Check } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

import {ftsTeam} from "@/components/fts-admin";
const sample = { name: "Asmi Battoo", phone: "", email: "asmi@example.com" };
const password = "PracticeReady123";
const key = "practice-ready-sample-profile-v1";
const credentialKey = "practice-ready-demo-credential-v1";
const validPhone = (value: string) => /^[+\d\s()-]+$/.test(value) && value.replace(/\D/g, "").length >= 10 && value.replace(/\D/g, "").length <= 15;
async function passwordDigest(value: string, salt: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${value}`)); return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join(""); }
const sessionKey = "practice-ready-sample-session-v1";
const field = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-slate-600 dark:bg-[#1B2133] dark:text-white";
const primary = "w-full rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-500";

type Profile = typeof sample;
const AccountControlsContext = createContext<ReactNode>(null);
export function AccountControls() { return <div className="shrink-0 max-[379px]:[&_button]:h-10 max-[379px]:[&_button]:w-10">{useContext(AccountControlsContext)}</div>; }

export default function SampleAccount({ children, controls, onLogout, adminView }: { children: ReactNode; controls: ReactNode; onLogout?: () => void; adminView?: (admin:typeof ftsTeam[number],logout:()=>void)=>ReactNode }) {
  const [admin,setAdmin]=useState<typeof ftsTeam[number]|null>(null);
  const [enteringAdmin,setEnteringAdmin]=useState<typeof ftsTeam[number]|null>(null);
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const authenticated = signedIn || !!admin;
  const pageTop = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!authenticated) return;
    pageTop.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [authenticated]);
  useEffect(() => {
    if (!enteringAdmin) return;
    // Commit a viewport-height document first. The outgoing login page must
    // stop being scrollable before Overview mounts, rather than sharing its
    // scroll position and relying on repeated corrections afterwards.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        setAdmin(enteringAdmin);
        setEnteringAdmin(null);
      });
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [enteringAdmin]);
  const [profile, setProfile] = useState<Profile>(sample);
  const [view, setView] = useState<"login" | "signup" | "forgot" | "sent">("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<"profile" | null>(null);
  const [draft, setDraft] = useState(sample);
  const [registration, setRegistration] = useState({name:"",phone:"",email:"",password:"",confirm:""});
  const [credential, setCredential] = useState<{salt:string;digest:string}|null>(null);
  const [signupStep,setSignupStep] = useState(1);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "null");
      if (stored && typeof stored.name === "string") setProfile({ ...sample, name: stored.name, phone: typeof stored.phone === "string" ? stored.phone : "", email: typeof stored.email === "string" ? stored.email : sample.email });
      const auth = JSON.parse(localStorage.getItem(credentialKey) || "null");
      if (auth && typeof auth.salt === "string" && typeof auth.digest === "string") setCredential(auth);
      const fts=ftsTeam.find(t=>t.email===sessionStorage.getItem("practice-ready-fts-session-v1"));if(fts)setAdmin(fts);
      if (sessionStorage.getItem(sessionKey) === "sample") setProfile(sample);
      setSignedIn(["signed-in", "sample"].includes(sessionStorage.getItem(sessionKey) || ""));
    } catch { /* Storage is optional for the sample flow. */ }
    setReady(true);
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const fts=ftsTeam.find(t=>t.email===email.trim().toLowerCase());
      if(fts){if(pass!=="PracticeReadyFTS123"){setError("Email or password is incorrect.");return;}sessionStorage.setItem("practice-ready-fts-session-v1",fts.email);if(document.activeElement instanceof HTMLElement)document.activeElement.blur();window.scrollTo({top:0,left:0,behavior:"instant"});setEnteringAdmin(fts);setPass("");return;}
      if (email.trim().toLowerCase() === sample.email && pass === password) {
        sessionStorage.setItem(sessionKey, "sample"); setProfile(sample); setPass(""); setSignedIn(true); return;
      }
      const storedProfile = JSON.parse(localStorage.getItem(key) || "null");
      const loginProfile = storedProfile && typeof storedProfile.name === "string" && typeof storedProfile.email === "string" ? {...sample, ...storedProfile} : profile;
      const correctPassword = credential ? await passwordDigest(pass, credential.salt) === credential.digest : pass === password;
      if (email.trim().toLowerCase() !== loginProfile.email.toLowerCase() || !correctPassword) {setError("Email or password is incorrect."); return;}
      sessionStorage.setItem(sessionKey, "signed-in"); setProfile(loginProfile); setPass(""); setSignedIn(true);
    } catch {setError("Could not log in. Please allow browser storage and try again.");}
    finally {setBusy(false);}
  }
  async function signup(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const next = {name:registration.name.trim(),phone:registration.phone.trim(),email:registration.email.trim().toLowerCase()};
    if (!next.name) {setError("Enter your full name.");return;}
    if (!validPhone(next.phone)) {setError("Enter a valid phone number with 10–15 digits.");return;}
    if(ftsTeam.some(t=>t.email===next.email)){setError("This email belongs to an authorised FTS account. Please log in.");return;}
    if (!/^[^\s@]+@vijaybhoomi\.edu\.in$/.test(next.email)) {setError("Use your Vijaybhoomi university email (@vijaybhoomi.edu.in).");return;}
    if (signupStep === 1) {setSignupStep(2);return;}
    if (registration.password.length < 8) {setError("Use a password with at least 8 characters.");return;}
    if (registration.password !== registration.confirm) {setError("Passwords do not match.");return;}
    setBusy(true);
    try {
      const salt = crypto.randomUUID(); const auth = {salt,digest:await passwordDigest(registration.password,salt)};
      // One local demo account; write credentials before reporting success.
      localStorage.setItem(credentialKey,JSON.stringify(auth)); localStorage.setItem(key,JSON.stringify(next)); sessionStorage.setItem(sessionKey,"signed-in");
      setCredential(auth);setProfile(next);setDraft(next);setRegistration({name:"",phone:"",email:"",password:"",confirm:""});setShow(false);setShowConfirm(false);setSignedIn(true);setView("login");
    } catch {setError("Could not save your demo account. Please allow browser storage and try again.");}
    finally {setBusy(false);}
  }
  function logout() {
    setAdmin(null);
    try { sessionStorage.removeItem("practice-ready-fts-session-v1");sessionStorage.removeItem(sessionKey); } catch {}
    setPanel(null); setSignedIn(false); setView("login"); setEmail(""); setPass(""); setError(""); onLogout?.();
  }
  const initials = profile.name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join("").toUpperCase() || "AB";
  const toolbar = <div className="flex items-center gap-2">{controls}{signedIn && <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild><button type="button" aria-label={`Account menu for ${profile.name}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-white bg-violet-600 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:bg-violet-700 hover:shadow-md motion-reduce:transform-none outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 dark:border-slate-600">{initials}</button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={10} className="w-64 rounded-2xl border-slate-200 bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-[#1B2133] dark:text-white">
      <DropdownMenuLabel className="px-3 py-3"><p className="truncate text-base font-semibold">{profile.name}</p><p className="truncate text-sm font-normal text-slate-500 dark:text-slate-300">{profile.email}</p></DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="rounded-lg border border-transparent px-3 py-3 text-sm transition-all duration-150 focus:border-violet-300 focus:bg-violet-50/70 focus:text-violet-800 data-[highlighted]:border-violet-300 data-[highlighted]:bg-violet-50/70 data-[highlighted]:text-violet-800 dark:focus:border-violet-500/70 dark:focus:bg-[#211A38] dark:focus:text-violet-100 dark:data-[highlighted]:border-violet-500/70 dark:data-[highlighted]:bg-[#211A38] dark:data-[highlighted]:text-violet-100" onSelect={() => { setDraft(profile); setSaved(false); setError(""); setPanel("profile"); }}><UserRound size={18}/>Manage account</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="rounded-lg border border-transparent px-3 py-3 text-sm transition-all duration-150 focus:border-violet-300 focus:bg-violet-50/70 focus:text-violet-800 data-[highlighted]:border-violet-300 data-[highlighted]:bg-violet-50/70 data-[highlighted]:text-violet-800 dark:focus:border-violet-500/70 dark:focus:bg-[#211A38] dark:focus:text-violet-100 dark:data-[highlighted]:border-violet-500/70 dark:data-[highlighted]:bg-[#211A38] dark:data-[highlighted]:text-violet-100 text-red-600 dark:text-red-400" onSelect={logout}><LogOut size={18}/>Log out</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>}</div>;

  if (!ready) return <main className="grid min-h-screen place-items-center bg-[#f7f8fc] text-violet-700 dark:bg-[#171D2D] dark:text-violet-300" aria-busy="true">Loading Practice Ready…</main>;

  if(enteringAdmin)return <main aria-busy="true" aria-label="Opening FTS Overview" className="h-[100dvh] overflow-hidden bg-[#f3efff] dark:bg-[#171D2D]" style={{overflowAnchor:"none"}}/>;

  if(admin&&adminView)return <><span ref={pageTop} tabIndex={-1} className="block h-0 outline-none"/>{adminView(admin,logout)}</>;
  if (!signedIn) return <main className="relative isolate min-h-[100dvh] overflow-x-clip bg-[#f3efff] text-[#151a31] dark:bg-[#171D2D] dark:text-white">
    <LoginAtmosphere />
    <div className="absolute right-4 top-4 z-40 hidden lg:block sm:right-8 sm:top-8">{toolbar}</div>
    <div className="relative z-10 mx-auto grid min-h-[100dvh] max-w-6xl lg:grid-cols-[.9fr_1.1fr]">
      <section className="relative hidden overflow-hidden bg-[#111733] dark:bg-[#0B0F1B] p-14 text-white lg:grid lg:min-h-0 lg:grid-rows-[auto_1fr_auto]">
          <div className="practice-ready-panel-ambient pointer-events-none absolute -left-24 top-24 h-72 w-72 rounded-full bg-violet-600/25 dark:bg-violet-400/20 blur-3xl" />
          <div className="practice-ready-panel-ambient pointer-events-none absolute -right-24 bottom-24 h-64 w-64 rounded-full bg-orange-300/10 dark:bg-orange-300/8 blur-3xl" style={{ animationDelay: "-5s" }} />
          <div className="practice-ready-panel-ambient pointer-events-none absolute left-1/3 top-1/2 h-60 w-60 rounded-full bg-indigo-500/10 dark:bg-indigo-400/10 blur-3xl" style={{ animationDelay: "-10s" }} />
        <div className="relative flex items-center gap-3 text-sm font-semibold tracking-wide text-white"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-500 dark:bg-violet-400"><Music2 size={20}/></span>TRUE SCHOOL OF MUSIC</div>
        <div className="relative self-center py-6"><p className="mb-5 text-sm font-bold uppercase tracking-[.22em] text-orange-300">Practice Ready</p><h1 className="text-5xl font-semibold leading-[1.06] tracking-[-.04em] text-white">Your next practice<br/>starts here.</h1><p className="mt-6 max-w-md text-lg leading-8 text-slate-300 dark:text-[#AAB3C7]">Find an open room and check its equipment before your session begins.</p></div>
        <LoginEqualizer />
      </section>
      <section className="min-h-0 px-6 pb-6 pt-5 sm:px-12 sm:pb-10 sm:pt-12 lg:flex lg:flex-col lg:px-16 lg:py-6"><div className="mx-auto w-full max-w-md lg:my-auto">
        <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4"><p className="text-sm font-semibold text-violet-700 dark:text-violet-300">Practice Ready</p><div className="lg:hidden">{toolbar}</div></div>
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{view === "signup" ? "Create account" : view === "login" ? "Welcome back" : view === "forgot" ? "Forgot your password?" : "Reset request received"}</h2>
        <p className="mb-4 mt-2 leading-6 sm:mb-5 sm:mt-3 text-slate-600 dark:text-slate-300">{view === "signup" ? "Get ready for your next practice at TSM." : view === "login" ? "Log in to get ready for your next practice." : view === "forgot" ? "Enter your email to try the password reset flow." : "This is a demo. No reset email has been sent and your password is unchanged."}</p>
        {view === "login" ? <form onSubmit={login} className="space-y-3 sm:space-y-5 lg:space-y-3">
          <label className="block text-sm font-semibold" htmlFor="login-email">Email<input id="login-email" className={field} type="email" autoComplete="username" required value={email} onChange={e => {setEmail(e.target.value);setError("");}}/></label>
          <div><label className="block text-sm font-semibold" htmlFor="login-password">Password</label><div className="relative"><input id="login-password" className={`${field} pr-14`} type={show ? "text" : "password"} autoComplete="current-password" required value={pass} onChange={e => {setPass(e.target.value);setError("");}}/><button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)} className="absolute bottom-1 right-1 grid h-11 w-11 place-items-center text-slate-500 dark:text-slate-300">{show ? <EyeOff size={20}/> : <Eye size={20}/>}</button></div>
          <button type="button" onClick={() => {setView("forgot");setError("");}} className="mt-2 inline-flex min-h-10 items-center text-left text-sm font-medium text-violet-700 hover:underline dark:text-violet-300">Forgot password?</button></div>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
          <button className={`${primary} disabled:opacity-60`} disabled={busy} type="submit">{busy ? "Logging in…" : "Log in"}</button>
          <p className="text-sm text-slate-600 dark:text-slate-300">Don’t have an account? <button type="button" className="min-h-10 font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={()=>{setView("signup");setSignupStep(1);setError("");setShow(false);}}>Create account</button></p>
          <div className="space-y-1">
            <details className="text-sm leading-6 text-slate-600 dark:text-slate-300"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Try the sample account</summary><div className="pb-1"><button type="button" className="min-h-10 text-violet-700 hover:underline dark:text-violet-300" onClick={() => {setEmail(sample.email);setPass(password);setError("");}}>Fill sample details</button></div></details>
            <details className="text-sm text-slate-500 dark:text-slate-300"><summary className="min-h-11 cursor-pointer py-2 sm:min-h-9 sm:pb-1">Try FTS admin access</summary>{ftsTeam.map(t=><button key={t.email} type="button" className="block min-h-11 py-1 text-violet-700 dark:text-violet-300 sm:min-h-8 sm:py-0.5" onClick={()=>{setEmail(t.email);setPass("PracticeReadyFTS123");}}>{t.name}</button>)}</details>
          </div>
        </form> : view === "signup" ? <form onSubmit={signup} className="space-y-3 sm:space-y-4">
          {signupStep===2&&<button type="button" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-violet-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-violet-300" onClick={()=>{setSignupStep(1);setError("");}}><span aria-hidden="true">←</span>Your details</button>}
          <p className="text-sm font-semibold text-violet-700 dark:text-violet-300" aria-live="polite">Step {signupStep} of 2 · {signupStep===1?"Your details":"Set your password"}</p>
          {signupStep===1&&([ ["name","Full name","text","name",80], ["email","University email","email","email",254], ["phone","Phone number","tel","tel",30] ] as const).map(([name,label,type,autocomplete,max])=><div key={name}><label htmlFor={`signup-${name}`} className="block text-sm font-semibold">{label}<input id={`signup-${name}`} type={type} autoComplete={autocomplete} required maxLength={max} className={field} value={registration[name]} onChange={e=>{setRegistration({...registration,[name]:e.target.value});setError("");}} aria-describedby={name==="phone"?"signup-phone-help":undefined}/></label>{name==="phone"&&<p id="signup-phone-help" className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-300">FTS may contact you about bookings or reported issues.</p>}</div>)}
          {signupStep===2&&(["password","confirm"] as const).map(name=><div key={name}><label htmlFor={`signup-${name}`} className="block text-sm font-semibold">{name==="password"?"Password":"Confirm password"}</label><div className="relative"><input id={`signup-${name}`} type={(name==="password"?show:showConfirm)?"text":"password"} autoComplete="new-password" required minLength={8} maxLength={128} className={`${field} pr-14`} value={registration[name]} onChange={e=>{setRegistration({...registration,[name]:e.target.value});setError("");}}/><button type="button" className="absolute bottom-1 right-1 grid h-11 w-11 place-items-center text-slate-500 dark:text-slate-300" aria-label={`${(name==="password"?show:showConfirm)?"Hide":"Show"} ${name==="confirm"?"confirmed password":"new password"}`} onClick={()=>name==="password"?setShow(!show):setShowConfirm(!showConfirm)}>{(name==="password"?show:showConfirm)?<EyeOff size={20}/>:<Eye size={20}/>}</button></div>{name==="password"&&<p className="mt-1 text-xs text-slate-500 dark:text-slate-300">At least 8 characters.</p>}</div>)}
          {error&&<p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}

          {signupStep===2&&<p className="text-xs leading-5 text-slate-500 dark:text-slate-300">Creating an account replaces the local demo profile on this browser.</p>}
          <button key={signupStep} type="submit" disabled={busy} className={`${primary} disabled:opacity-60`}>{signupStep===1?"Continue":busy?"Creating account…":"Create account"}</button>
          <p className="text-sm text-slate-600 dark:text-slate-300">Already have an account? <button type="button" className="min-h-10 font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={()=>{setView("login");setError("");setShow(false);}}>Log in</button></p>
          <details className="text-xs leading-5 text-slate-500 dark:text-slate-300"><summary className="min-h-11 cursor-pointer py-3">Demo account · saved on this device</summary><p className="pb-2">One account per browser. Email is not verified and FTS cannot access this demo data.</p></details>
        </form> : view === "forgot" ? <form onSubmit={e => {e.preventDefault();setView("sent");}} className="space-y-5"><label htmlFor="reset-email" className="block text-sm font-semibold">Email<input id="reset-email" type="email" required autoComplete="email" className={field} value={email} onChange={e => setEmail(e.target.value)}/></label><button type="submit" className={primary}>Request password reset</button><p className="text-sm text-slate-500 dark:text-slate-300">Demo only. No email will be sent.</p><button type="button" onClick={() => setView("login")} className="min-h-11 text-sm font-medium text-violet-700 dark:text-violet-300">Back to login</button></form> : <div><Check className="mb-6 text-violet-600" size={32}/><button className={primary} onClick={() => {setView("login");setPass("");}}>Back to login</button></div>}
      </div></section>
    </div>
  </main>;

  return <AccountControlsContext.Provider value={toolbar}><span ref={pageTop} tabIndex={-1} className="block h-0 outline-none"/><style>{`@media(max-width:1023px){.account-global-controls{display:none;}}`}</style>{children}<div className="account-global-controls fixed right-4 top-4 z-40 sm:right-8 sm:top-8">{toolbar}</div>
    <Dialog open={panel !== null} onOpenChange={open => {if (!open) {setPanel(null);setError("");}}}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl bg-white text-slate-900 dark:bg-[#1B2133] dark:text-white">
        <DialogHeader><DialogTitle>Manage account</DialogTitle><DialogDescription>Update your name, phone number, and email on this device.</DialogDescription></DialogHeader>
        {<form className="space-y-4" onSubmit={e => {e.preventDefault();const name=draft.name.trim();if (!name) {setError("Enter your full name.");return;} if (!validPhone(draft.phone.trim())) {setError("Enter a valid phone number with 10–15 digits.");return;} const next={name,phone:draft.phone.trim(),email:draft.email.trim().toLowerCase()};setProfile(next);setDraft(next);try {localStorage.setItem(key,JSON.stringify(next));} catch {}setError("");setSaved(true);setPanel(null);}}>
          <label htmlFor="profile-name" className="block text-sm font-semibold">Name<input id="profile-name" className={field} required maxLength={80} value={draft.name} onChange={e => {setDraft({...draft,name:e.target.value});setSaved(false);}}/></label>
          <label htmlFor="profile-phone" className="block text-sm font-semibold">Phone number<input id="profile-phone" className={field} required type="tel" autoComplete="tel" maxLength={30} placeholder="Enter your phone number" value={draft.phone} onChange={e => {setDraft({...draft,phone:e.target.value});setSaved(false);}}/></label>
          <label htmlFor="profile-email" className="block text-sm font-semibold">Email<input id="profile-email" className={field} type="email" autoComplete="email" required maxLength={254} value={draft.email} onChange={e => {setDraft({...draft,email:e.target.value});setSaved(false);}}/></label>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}{saved && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Profile saved.</p>}
          <button type="submit" className={primary}>Save changes</button>
        </form>}
      </DialogContent>
    </Dialog>
  </AccountControlsContext.Provider>;
}
