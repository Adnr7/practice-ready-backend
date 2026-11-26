"use client";
import {beginRestrictionPreview,endRestrictionPreview,previewStudent,type RestrictionPreviewMode} from "@/lib/preview-storage";


import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LoginAtmosphere, LoginEqualizer } from "@/components/login-atmosphere";
import { Eye, EyeOff, LogOut, UserRound, Music2, Check, LockKeyhole } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { acceptGuidelines, login as apiLogin, logout as apiLogout, me, register as apiRegister, updateCurrentUser, type UserProfile } from "@/lib/api-client";

import {students,ACCESS_EVENT,setAuthenticatedStudent} from "@/lib/student-access";
import BookingGuidelines, { GUIDELINES_AGREEMENT } from "@/components/booking-guidelines";
import {ftsTeam,ftsMembers,refreshFtsMembers} from "@/lib/fts-members";
const sample = { name: "", phone: "", email: "" };
const validPhone = (value: string) => /^[+\d\s()-]+$/.test(value) && value.replace(/\D/g, "").length >= 10 && value.replace(/\D/g, "").length <= 15;
const staffSessionKey = "practice-ready-fts-session-v1";
const field = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-slate-600 dark:bg-[#1B2133] dark:text-white";
const primary = "w-full rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-500";

type Profile = typeof sample;
const profileFromApi = (user: UserProfile): Profile => ({ name: user.fullName, phone: user.phone ?? "", email: user.email });
const adminFromApi = (user: UserProfile) => ({ name: user.fullName, email: user.email, phone: user.phone ?? "" });
function cacheBackendIdentity(user: UserProfile) {
  setAuthenticatedStudent(user.role === "student" ? { name: user.fullName, email: user.email, phone: user.phone ?? "" } : null);
  try {
    if (user.role === "technician" || user.role === "admin") sessionStorage.setItem(staffSessionKey, user.email);
    else sessionStorage.removeItem(staffSessionKey);
  } catch { /* Optional compatibility marker. */ }
}
function clearBackendIdentity() {
  setAuthenticatedStudent(null);
  try { sessionStorage.removeItem(staffSessionKey); } catch { /* Optional compatibility marker. */ }
}
function AuthenticatedAdminView({admin,onLogout,render}:{admin:typeof ftsTeam[number];onLogout:()=>void;render:(admin:typeof ftsTeam[number],logout:()=>void)=>ReactNode}){return <>{render(admin,onLogout)}</>;}
const AccountControlsContext = createContext<ReactNode>(null);
export function AccountControls() { return <div className="shrink-0 max-[379px]:[&_button]:h-10 max-[379px]:[&_button]:w-10">{useContext(AccountControlsContext)}</div>; }

export default function SampleAccount({ children, controls, onLogout, adminView }: { children: ReactNode; controls: ReactNode; onLogout?: () => void; adminView?: (admin:typeof ftsTeam[number],logout:()=>void)=>ReactNode }) {
  const [admin,setAdmin]=useState<typeof ftsTeam[number]|null>(null);
  const [enteringAdmin,setEnteringAdmin]=useState<typeof ftsTeam[number]|null>(null);
  const [profile, setProfile] = useState<Profile>({ name: "Practice Ready", phone: "", email: "" });
  const [draft, setDraft] = useState(sample);
  useEffect(()=>{const refresh=()=>{const email=sessionStorage.getItem("practice-ready-fts-session-v1");if(!email)return;try{const member=ftsMembers().find(m=>m.email===email);if(member){setAdmin(member);setProfile({name:member.name,phone:member.phone,email:member.email});setDraft({name:member.name,phone:member.phone,email:member.email});}else if(!enteringAdmin)setAdmin(null);}catch{}};window.addEventListener("practice-ready-fts-members-changed",refresh);window.addEventListener("storage",refresh);return()=>{window.removeEventListener("practice-ready-fts-members-changed",refresh);window.removeEventListener("storage",refresh);};},[enteringAdmin]);
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
  const [restrictionChooser,setRestrictionChooser]=useState(false);
  const [restrictionDemo,setRestrictionDemo]=useState<RestrictionPreviewMode|null>(null);
  const [previewGeneration,setPreviewGeneration]=useState(0);
  const previewProfile=useRef<Profile>(sample);
  const previewSession=useRef(false);
  useEffect(()=>()=>endRestrictionPreview(),[]);
  const exitRestrictionPreview=()=>{const shouldLogout=previewSession.current;endRestrictionPreview();if(shouldLogout){previewSession.current=false;void apiLogout().then(result=>{if(result.success){clearBackendIdentity();setSignedIn(false);setAdmin(null);onLogout?.();}else setError(result.error||"Could not end the sample preview session. Retry logout.");});}previewSession.current=false;setRestrictionDemo(null);setProfile(previewProfile.current);setPreviewGeneration(n=>n+1);setPanel(null);window.dispatchEvent(new Event(ACCESS_EVENT));window.scrollTo(0,0);};
  const launchRestrictionPreview=(mode:RestrictionPreviewMode)=>{previewProfile.current=profile;previewSession.current=signedIn||!!admin;beginRestrictionPreview(mode);setRestrictionDemo(mode);setRestrictionChooser(false);setProfile(previewStudent);setPreviewGeneration(n=>n+1);window.scrollTo(0,0);};

  const [view, setView] = useState<"login" | "signup" | "forgot" | "sent">("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<"profile" | null>(null);
  const [registration, setRegistration] = useState({name:"",phone:"",email:"",password:"",confirm:""});
  const [signupStep,setSignupStep] = useState(1);
  const [guidelinesAccepted,setGuidelinesAccepted] = useState(false);
  const signupHeading = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(()=>{if(view!=="signup")return;signupHeading.current?.focus({preventScroll:true});window.scrollTo({top:0,left:0,behavior:"instant"});},[signupStep,view]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void me().then((user) => {
      if (cancelled) return;
      if (user) {
        cacheBackendIdentity(user);
        setProfile(profileFromApi(user));
        setDraft(profileFromApi(user));
        if (user.role === "student") setSignedIn(true);
        else { setAdmin(adminFromApi(user)); setSignedIn(false); void refreshFtsMembers(); }
      }
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!saved || !signedIn) return;
    void updateCurrentUser({ fullName: profile.name, phone: profile.phone });
  }, [profile.name, profile.phone, saved, signedIn]);

  async function login(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const result = await apiLogin({ email: email.trim().toLowerCase(), password: pass });
      if (!result.success || !result.user) { setError(result.error ?? "Email or password is incorrect."); return; }
      cacheBackendIdentity(result.user);
      const next = profileFromApi(result.user);
      setProfile(next); setDraft(next); setPass("");
      if (result.user.role === "student") {
        setSignedIn(true);
      } else {
        const staff = adminFromApi(result.user);
        setAdmin(staff);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        setEnteringAdmin(staff);
      }
    } catch {setError("Could not log in. Please allow browser storage and try again.");}
    finally {setBusy(false);}
  }
  async function signup(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const next = {name:registration.name.trim(),phone:registration.phone.trim(),email:registration.email.trim().toLowerCase()};
    if (!next.name) {setError("Enter your full name.");return;}
    if (!validPhone(next.phone)) {setError("Enter a valid phone number with 10–15 digits.");return;}
    if(ftsMembers().some(t=>t.email===next.email)){setError("This email belongs to an authorised ATS account. Please log in.");return;}
    if (!/^[^\s@]+@vijaybhoomi\.edu\.in$/.test(next.email)) {setError("Use your Vijaybhoomi university email (@vijaybhoomi.edu.in).");return;}
    if(students().some(s=>s.email===next.email)){setError("This email already has an account. Sign in, or contact ATS if the account was deleted.");return;}
    if (signupStep === 1) {setSignupStep(2);return;}
    if (registration.password.length < 8) {setError("Use a password with at least 8 characters.");return;}
    if (registration.password !== registration.confirm) {setError("Passwords do not match.");return;}
    if(signupStep===2){setGuidelinesAccepted(false);setSignupStep(3);return;}
    if(!guidelinesAccepted){setError("Read and agree to the booking and equipment guidelines to create your account.");return;}
    setBusy(true);
    try {
      const result = await apiRegister({ email: next.email, password: registration.password, fullName: next.name });
      if (!result.success || !result.user) { setError(result.error ?? "Could not create your account."); return; }
      cacheBackendIdentity(result.user);
      const updated = await updateCurrentUser({ fullName: next.name, phone: next.phone });
      void acceptGuidelines().catch(() => {});
      const saved = updated.success && updated.user ? profileFromApi(updated.user) : profileFromApi(result.user);
      setProfile(saved); setDraft(saved); setRegistration({name:"",phone:"",email:"",password:"",confirm:""}); setShow(false); setShowConfirm(false); setSignedIn(true); setAdmin(null); setView("login");
    } catch {setError("Could not create your account. Please try again.");}
    finally {setBusy(false);}
  }
  async function logout() {
    const wasPreviewing=restrictionDemo;
    endRestrictionPreview();setRestrictionDemo(null);previewSession.current=false;
    const result = await apiLogout();
    if (!result.success) { if(wasPreviewing){beginRestrictionPreview(wasPreviewing);setRestrictionDemo(wasPreviewing);}setError(result.error ?? "Could not sign out."); return; }
    clearBackendIdentity();
    setPanel(null); setSignedIn(false); setAdmin(null); setEnteringAdmin(null); setView("login"); setEmail(""); setPass(""); setError(""); onLogout?.();
  }
  const initials = profile.name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join("").toUpperCase() || "AB";
  const toolbar = <div className="flex items-center gap-2">{controls}{authenticated && <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild><button type="button" aria-label={`Account menu for ${profile.name}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-white bg-violet-600 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:bg-violet-700 hover:shadow-md motion-reduce:transform-none outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 dark:border-slate-600">{initials}</button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={10} className="w-64 rounded-2xl border-slate-200 bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-[#1B2133] dark:text-white">
      <DropdownMenuLabel className="px-3 py-3"><p className="truncate text-base font-semibold">{profile.name}</p><p className="truncate text-sm font-normal text-slate-500 dark:text-slate-300">{profile.email}</p></DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="rounded-lg border border-transparent px-3 py-3 text-sm transition-all duration-150 focus:border-violet-300 focus:bg-violet-50/70 focus:text-violet-800 data-[highlighted]:border-violet-300 data-[highlighted]:bg-violet-50/70 data-[highlighted]:text-violet-800 dark:focus:border-violet-500/70 dark:focus:bg-[#211A38] dark:focus:text-violet-100 dark:data-[highlighted]:border-violet-500/70 dark:data-[highlighted]:bg-[#211A38] dark:data-[highlighted]:text-violet-100" onSelect={() => { setDraft(profile); setSaved(false); setError(""); setPanel("profile"); }}><UserRound size={18}/>{admin?"Manage ATS account":"Manage account"}</DropdownMenuItem>
      {authenticated&&restrictionDemo===null&&<DropdownMenuItem className="min-h-11 gap-2 rounded-lg px-3 py-3 text-sm focus:bg-violet-50 dark:focus:bg-[#211A38]" onSelect={()=>setRestrictionChooser(true)}><Eye size={18}/>Preview restrictions</DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuItem className="rounded-lg border border-transparent px-3 py-3 text-sm transition-all duration-150 focus:border-violet-300 focus:bg-violet-50/70 focus:text-violet-800 data-[highlighted]:border-violet-300 data-[highlighted]:bg-violet-50/70 data-[highlighted]:text-violet-800 dark:focus:border-violet-500/70 dark:focus:bg-[#211A38] dark:focus:text-violet-100 dark:data-[highlighted]:border-violet-500/70 dark:data-[highlighted]:bg-[#211A38] dark:data-[highlighted]:text-violet-100 text-red-600 dark:text-red-400" onSelect={logout}><LogOut size={18}/>Log out</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>}</div>;

  if (!ready) return <main className="grid min-h-screen place-items-center bg-[#f7f8fc] text-violet-700 dark:bg-[#171D2D] dark:text-violet-300" aria-busy="true">Loading Practice Ready…</main>;

  if(enteringAdmin)return <main aria-busy="true" aria-label="Opening ATS Overview" className="h-[100dvh] overflow-hidden bg-[#f3efff] dark:bg-[#171D2D]" style={{overflowAnchor:"none"}}/>;

  if(admin&&adminView)return <AuthenticatedAdminView admin={admin} onLogout={logout} render={adminView}/>;
  if(!signedIn&&view==="signup"&&signupStep===3)return <main className="relative isolate min-h-[100dvh] overflow-x-clip bg-[#f3efff] text-[#151a31] dark:bg-[#171D2D] dark:text-white">
    <div className="pointer-events-none fixed inset-0 -z-10 h-[100dvh]" aria-hidden="true"><LoginAtmosphere/></div>
    <div className="absolute right-4 top-4 z-40 hidden lg:block sm:right-8 sm:top-8">{toolbar}</div>
    <div className="mx-auto w-full max-w-[914px] px-5 pb-8 pt-5 sm:px-8 sm:pb-12 sm:pt-8">
      <div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 font-semibold text-violet-700 dark:text-violet-300"><Music2 size={20} aria-hidden="true"/>Practice Ready</p><div className="lg:hidden">{toolbar}</div></div>
      <div className="mb-3 mt-4 flex items-center justify-between gap-3"><button type="button" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={()=>{setSignupStep(2);setGuidelinesAccepted(false);setError("");}}>← Your password</button>
      <p ref={signupHeading} tabIndex={-1} className="shrink-0 text-right text-sm font-semibold text-violet-700 outline-none dark:text-violet-300">Step 3 of 3</p></div>
      <h1 className="mb-5 mt-2 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">Booking &amp; equipment guidelines</h1>
      <form onSubmit={signup} className="space-y-5">
        <BookingGuidelines/>
        <section aria-label="Your agreement" className="space-y-4 rounded-2xl border border-violet-200 bg-white p-4 dark:border-violet-500/40 dark:bg-[#1B2133] sm:p-5">
          <label className="flex cursor-pointer items-start gap-3 text-sm leading-6"><input type="checkbox" required checked={guidelinesAccepted} onChange={e=>{setGuidelinesAccepted(e.target.checked);setError("");}} className="mt-1 h-5 w-5 shrink-0 accent-violet-600"/><span>{GUIDELINES_AGREEMENT}</span></label>
          {error&&<p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
          <button type="submit" disabled={busy||!guidelinesAccepted} className={`${primary} min-h-12 disabled:cursor-not-allowed disabled:opacity-60`}>{busy?"Creating account…":"Agree & create account"}</button>
          <p className="text-xs leading-5 text-slate-500 dark:text-slate-300">Accounts and joint-practice invitations are saved in this browser only.</p>
        </section>
      </form>
    </div>
  </main>;
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
              <p className="text-xs text-slate-500 dark:text-slate-300">Sample login shortcuts are disabled. Use an authorized account issued by your administrator.</p>
        </form> : view === "signup" ? <form onSubmit={signup} className="space-y-3 sm:space-y-4">
          {signupStep>1&&<button type="button" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-violet-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-violet-300" onClick={()=>{setSignupStep(signupStep-1);setGuidelinesAccepted(false);setError("");}}><span aria-hidden="true">←</span>{signupStep===2?"Your details":"Your password"}</button>}
          <p ref={signupHeading} tabIndex={-1} className="text-sm font-semibold text-violet-700 outline-none dark:text-violet-300" aria-live="polite">Step {signupStep} of 3 · {signupStep===1?"Your details":signupStep===2?"Set your password":"Booking & equipment guidelines"}</p>
          {signupStep===1&&([ ["name","Full name","text","name",80], ["email","University email","email","email",254], ["phone","Phone number","tel","tel",30] ] as const).map(([name,label,type,autocomplete,max])=><div key={name}><label htmlFor={`signup-${name}`} className="block text-sm font-semibold">{label}<input id={`signup-${name}`} type={type} autoComplete={autocomplete} required maxLength={max} className={field} value={registration[name]} onChange={e=>{setRegistration({...registration,[name]:e.target.value});setError("");}} aria-describedby={name==="phone"?"signup-phone-help":undefined}/></label>{name==="phone"&&<p id="signup-phone-help" className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-300">ATS may contact you about bookings or reported issues.</p>}</div>)}
          {signupStep===2&&(["password","confirm"] as const).map(name=><div key={name}><label htmlFor={`signup-${name}`} className="block text-sm font-semibold">{name==="password"?"Password":"Confirm password"}</label><div className="relative"><input id={`signup-${name}`} type={(name==="password"?show:showConfirm)?"text":"password"} autoComplete="new-password" required minLength={8} maxLength={128} className={`${field} pr-14`} value={registration[name]} onChange={e=>{setRegistration({...registration,[name]:e.target.value});setError("");}}/><button type="button" className="absolute bottom-1 right-1 grid h-11 w-11 place-items-center text-slate-500 dark:text-slate-300" aria-label={`${(name==="password"?show:showConfirm)?"Hide":"Show"} ${name==="confirm"?"confirmed password":"new password"}`} onClick={()=>name==="password"?setShow(!show):setShowConfirm(!showConfirm)}>{(name==="password"?show:showConfirm)?<EyeOff size={20}/>:<Eye size={20}/>}</button></div>{name==="password"&&<p className="mt-1 text-xs text-slate-500 dark:text-slate-300">At least 8 characters.</p>}</div>)}
          {error&&<p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}

          {signupStep===3&&<><BookingGuidelines showRevisitHint/><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-violet-200 bg-white p-4 text-sm leading-6 dark:border-violet-500/40 dark:bg-[#1B2133]"><input type="checkbox" required checked={guidelinesAccepted} onChange={e=>{setGuidelinesAccepted(e.target.checked);setError("");}} className="mt-1 h-5 w-5 shrink-0 accent-violet-600"/><span>{GUIDELINES_AGREEMENT}</span></label></>}
          {signupStep===3&&<p className="text-xs leading-5 text-slate-500 dark:text-slate-300">Accounts and joint-practice invitations are saved in this browser only.</p>}
          <button key={signupStep} type="submit" disabled={busy||(signupStep===3&&!guidelinesAccepted)} className={`${primary} disabled:opacity-60`}>{signupStep<3?"Continue":busy?"Creating account…":"Agree & create account"}</button>
          <p className="text-sm text-slate-600 dark:text-slate-300">Already have an account? <button type="button" className="min-h-10 font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={()=>{setView("login");setError("");setShow(false);}}>Log in</button></p>
          <details className="text-xs leading-5 text-slate-500 dark:text-slate-300"><summary className="min-h-11 cursor-pointer py-3">Demo account · saved on this device</summary><p className="pb-2">One account per browser. Email is not verified. Student and ATS demo views use local records on this browser.</p></details>
        </form> : view === "forgot" ? <form onSubmit={e => {e.preventDefault();setView("sent");}} className="space-y-5"><label htmlFor="reset-email" className="block text-sm font-semibold">Email<input id="reset-email" type="email" required autoComplete="email" className={field} value={email} onChange={e => setEmail(e.target.value)}/></label><button type="submit" className={primary}>Request password reset</button><p className="text-sm text-slate-500 dark:text-slate-300">Demo only. No email will be sent.</p><button type="button" onClick={() => setView("login")} className="min-h-11 text-sm font-medium text-violet-700 dark:text-violet-300">Back to login</button></form> : <div><Check className="mb-6 text-violet-600" size={32}/><button className={primary} onClick={() => {setView("login");setPass("");}}>Back to login</button></div>}
      </div></section>
    </div>
  </main>;

  return <AccountControlsContext.Provider value={toolbar}><span ref={pageTop} tabIndex={-1} className="block h-0 outline-none"/><style>{`@media(max-width:1023px){.account-global-controls{display:none;}}`}</style>{restrictionDemo!==null&&<aside className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-violet-300 bg-violet-50 p-3 text-sm text-slate-900 dark:bg-[#211A38] dark:text-white" aria-label="Restriction preview"><p><strong>Student restriction preview</strong> · {restrictionDemo==="equipment"?"Equipment moves only":"Room bookings and equipment moves"}<span className="block text-xs">Sample records only. Changes are discarded on exit.</span></p><div className="flex items-center gap-3"><div className="hidden lg:block">{toolbar}</div><button type="button" className="min-h-11 rounded-xl border border-violet-300 px-4 font-semibold text-violet-700 dark:text-violet-200" onClick={exitRestrictionPreview}>Exit preview</button></div></aside>}<div key={`${profile.email}-${previewGeneration}`}>{children}</div>{restrictionDemo===null&&<div className="account-global-controls fixed right-4 top-4 z-40 sm:right-8 sm:top-8">{toolbar}</div>}
    <Dialog open={restrictionChooser} onOpenChange={setRestrictionChooser}><DialogContent className="rounded-3xl bg-white dark:bg-[#1B2133]"><DialogHeader><DialogTitle>Preview restrictions</DialogTitle><DialogDescription>Explore the student experience with temporary sample records. Saved activity is unchanged.</DialogDescription></DialogHeader><div className="grid gap-3">{([{mode:"facilities",label:"Room bookings and equipment moves restricted"},{mode:"equipment",label:"Equipment moves restricted only"}] as const).map(option=><button key={option.mode} type="button" className="min-h-11 rounded-xl border border-violet-300 p-3 text-left font-semibold text-violet-700 hover:bg-violet-50 dark:text-violet-200 dark:hover:bg-[#211A38]" onClick={()=>launchRestrictionPreview(option.mode)}>{option.label}</button>)}</div></DialogContent></Dialog>
    <Dialog open={panel !== null} onOpenChange={open => {if (!open) {setPanel(null);setError("");}}}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl bg-white text-slate-900 dark:bg-[#1B2133] dark:text-white">
        <DialogHeader><DialogTitle>Manage account</DialogTitle><DialogDescription>Update your name and phone number. Your university email identifies your account.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={async e => {e.preventDefault();const fullName=draft.name.trim();if (!fullName) {setError("Enter your full name.");return;} if (!validPhone(draft.phone.trim())) {setError("Enter a valid phone number.");return;}setBusy(true);setError("");const result=await updateCurrentUser({fullName,phone:draft.phone.trim()});setBusy(false);if(!result.success||!result.user){setError(result.error||"Could not save your account.");return;}cacheBackendIdentity(result.user);const next=profileFromApi(result.user);setProfile(next);setDraft(next);setSaved(true);setPanel(null);}}>
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          <label htmlFor="profile-name" className="block text-sm font-semibold">Name<input id="profile-name" className={field} required maxLength={80} value={draft.name} onChange={e => {setDraft({...draft,name:e.target.value});setSaved(false);}}/></label>
          <label htmlFor="profile-phone" className="block text-sm font-semibold">Phone number<input id="profile-phone" className={field} required type="tel" autoComplete="tel" maxLength={30} placeholder="Enter your phone number" value={draft.phone} onChange={e => {setDraft({...draft,phone:e.target.value});setSaved(false);}}/></label>
          </div>
          <div className="space-y-1 text-sm"><p className="font-semibold">Email</p><p className="break-all text-slate-500 dark:text-slate-300">{profile.email}</p><p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><LockKeyhole size={14} aria-hidden="true"/>Email can’t be changed.</p></div>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}{saved && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Profile saved.</p>}
          <button type="submit" disabled={busy} className={`${primary} disabled:opacity-50`}>{busy?"Saving…":"Save changes"}</button>
        </form>
      </DialogContent>
    </Dialog>
  </AccountControlsContext.Provider>;
}
