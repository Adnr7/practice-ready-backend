"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Eye, EyeOff, LogOut, Music2, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoginAtmosphere, LoginEqualizer } from "@/components/login-atmosphere";
import { login, register, updateCurrentUser, type UserProfile } from "@/lib/api-client";

const field =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-slate-600 dark:bg-[#1B2133] dark:text-white";
const primary =
  "w-full rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60";
const validPhone = (value: string) =>
  /^[+\d\s()-]+$/.test(value) &&
  value.replace(/\D/g, "").length >= 10 &&
  value.replace(/\D/g, "").length <= 15;

export type SampleAccountProps = {
  onUserChange: (user: UserProfile) => void;
  controls?: ReactNode;
};

/**
 * The original Asmi account surface, with its mutations connected to the
 * application API rather than browser-only demo storage.
 *
 * This component deliberately renders the login page on the first server
 * render. A client-only loading shell can leave a production browser showing
 * only the lavender background when a client chunk fails before hydration.
 */
export default function SampleAccount({ onUserChange, controls }: SampleAccountProps) {
  const [view, setView] = useState<"login" | "signup" | "forgot" | "sent">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [signupStep, setSignupStep] = useState(1);
  const [registration, setRegistration] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fillSample = () => {
    // Keep the original affordance without embedding a password or bypassing
    // the real server authentication flow.
    setEmail("student@tsm.edu.in");
    setPassword("");
    setError("Use the student password configured for this environment.");
  };

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await login({ email: email.trim(), password });
    setBusy(false);
    if (!result.success || !result.user) {
      setError(result.error ?? "Email or password is incorrect.");
      return;
    }
    setPassword("");
    onUserChange(result.user);
  };

  const submitSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const next = {
      name: registration.name.trim(),
      phone: registration.phone.trim(),
      email: registration.email.trim().toLowerCase(),
    };
    if (!next.name) {
      setError("Enter your full name.");
      return;
    }
    if (!validPhone(next.phone)) {
      setError("Enter a valid phone number with 10–15 digits.");
      return;
    }
    if (!/^[^\s@]+@vijaybhoomi\.edu\.in$/.test(next.email)) {
      setError("Use your Vijaybhoomi university email (@vijaybhoomi.edu.in).");
      return;
    }
    if (signupStep === 1) {
      setSignupStep(2);
      return;
    }
    if (registration.password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (registration.password !== registration.confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    const result = await register({
      email: next.email,
      password: registration.password,
      fullName: next.name,
    });
    if (!result.success || !result.user) {
      setError(result.error ?? "Could not create your account.");
      setBusy(false);
      return;
    }
    const profile = await updateCurrentUser({
      fullName: next.name,
      phone: next.phone,
    });
    setBusy(false);
    setPassword("");
    onUserChange(profile.success && profile.user ? profile.user : result.user);
  };

  return (
    <main className="relative isolate min-h-[100dvh] overflow-x-clip bg-[#f3efff] text-[#151a31] dark:bg-[#171D2D] dark:text-white">
      <LoginAtmosphere />
      {controls && (
        <div className="absolute right-4 top-4 z-40 hidden items-center gap-2 lg:flex sm:right-8 sm:top-8">
          {controls}
        </div>
      )}
      <div className="relative z-10 mx-auto grid min-h-[100dvh] max-w-6xl lg:grid-cols-[.9fr_1.1fr]">
        <section className="relative hidden overflow-hidden bg-[#111733] p-14 text-white dark:bg-[#0B0F1B] lg:grid lg:grid-rows-[auto_1fr_auto]">
          <div className="practice-ready-panel-ambient pointer-events-none absolute -left-24 top-24 h-72 w-72 rounded-full bg-violet-600/25 blur-3xl" />
          <div className="practice-ready-panel-ambient pointer-events-none absolute -right-24 bottom-24 h-64 w-64 rounded-full bg-orange-300/10 blur-3xl" style={{ animationDelay: "-5s" }} />
          <div className="relative flex items-center gap-3 text-sm font-semibold tracking-wide">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-500">
              <Music2 size={20} />
            </span>
            TRUE SCHOOL OF MUSIC
          </div>
          <div className="relative self-center py-6">
            <p className="mb-5 text-sm font-bold uppercase tracking-[.22em] text-orange-300">Practice Ready</p>
            <h1 className="text-5xl font-semibold leading-[1.06] tracking-[-.04em]">
              Your next practice
              <br />
              starts here.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-8 text-slate-300">
              Find an open room and check its equipment before your session begins.
            </p>
          </div>
          <LoginEqualizer />
        </section>
        <section className="min-h-0 px-6 pb-6 pt-5 sm:px-12 sm:pb-10 sm:pt-12 lg:flex lg:flex-col lg:justify-center lg:px-16 lg:py-6">
          <div className="mx-auto w-full max-w-md">
            <div className="mb-3 flex items-center justify-between gap-2 lg:hidden">
              <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">Practice Ready</p>
              <div className="flex items-center gap-2">{controls}</div>
            </div>
            <p className="mb-3 hidden text-sm font-semibold text-violet-700 dark:text-violet-300 lg:block">Practice Ready</p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {view === "signup" ? "Create account" : view === "login" ? "Welcome back" : view === "forgot" ? "Forgot your password?" : "Reset request received"}
            </h2>
            <p className="mb-4 mt-2 leading-6 text-slate-600 dark:text-slate-300">
              {view === "signup" ? "Get ready for your next practice at TSM." : view === "login" ? "Log in to get ready for your next practice." : view === "forgot" ? "Enter your email to try the password reset flow." : "This is a demo. No reset email has been sent and your password is unchanged."}
            </p>
            {view === "login" && (
              <form onSubmit={submitLogin} className="space-y-3 sm:space-y-5 lg:space-y-3">
                <label className="block text-sm font-semibold" htmlFor="login-email">
                  Email
                  <input id="login-email" className={field} type="email" autoComplete="username" required value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} />
                </label>
                <div>
                  <label className="block text-sm font-semibold" htmlFor="login-password">Password</label>
                  <div className="relative">
                    <input id="login-password" className={`${field} pr-14`} type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} />
                    <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)} className="absolute bottom-1 right-1 grid h-11 w-11 place-items-center text-slate-500 dark:text-slate-300">
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                  <button type="button" onClick={() => { setView("forgot"); setError(""); }} className="mt-2 inline-flex min-h-10 items-center text-left text-sm font-medium text-violet-700 hover:underline dark:text-violet-300">Forgot password?</button>
                </div>
                {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
                <button className={primary} disabled={busy} type="submit">{busy ? "Logging in…" : "Log in"}</button>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Don’t have an account? <button type="button" className="min-h-10 font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={() => { setView("signup"); setSignupStep(1); setError(""); }}>Create account</button>
                </p>
                <div className="space-y-1">
                  <details className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                    <summary className="min-h-11 cursor-pointer py-2 font-semibold">Try the sample account</summary>
                    <div className="pb-1"><button type="button" className="min-h-10 text-violet-700 hover:underline dark:text-violet-300" onClick={fillSample}>Fill sample details</button></div>
                  </details>
                  <details className="text-sm text-slate-500 dark:text-slate-300">
                    <summary className="min-h-11 cursor-pointer py-2 sm:min-h-9 sm:pb-1">Try FTS admin access</summary>
                    <p className="pb-1 text-xs leading-5">Use the configured administrator password with admin@tsm.edu.in.</p>
                    <button type="button" className="block min-h-10 py-1 text-violet-700 dark:text-violet-300" onClick={() => { setEmail("admin@tsm.edu.in"); setPassword(""); setError(""); }}>Fill administrator email</button>
                  </details>
                </div>
              </form>
            )}
            {view === "signup" && (
              <form onSubmit={submitSignup} className="space-y-3 sm:space-y-4">
                {signupStep === 2 && <button type="button" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={() => { setSignupStep(1); setError(""); }}>← Your details</button>}
                <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">Step {signupStep} of 2 · {signupStep === 1 ? "Your details" : "Set your password"}</p>
                {signupStep === 1 && <>
                  <label className="block text-sm font-semibold" htmlFor="signup-name">Full name<input id="signup-name" className={field} required maxLength={80} value={registration.name} onChange={(event) => setRegistration({ ...registration, name: event.target.value })} /></label>
                  <label className="block text-sm font-semibold" htmlFor="signup-email">University email<input id="signup-email" className={field} type="email" required maxLength={254} value={registration.email} onChange={(event) => setRegistration({ ...registration, email: event.target.value })} /></label>
                  <label className="block text-sm font-semibold" htmlFor="signup-phone">Phone number<input id="signup-phone" className={field} type="tel" required maxLength={30} value={registration.phone} onChange={(event) => setRegistration({ ...registration, phone: event.target.value })} /></label>
                  <p className="text-xs leading-5 text-slate-500 dark:text-slate-300">FTS may contact you about bookings or reported issues.</p>
                </>}
                {signupStep === 2 && <>
                  <label className="block text-sm font-semibold" htmlFor="signup-password">Password
                    <div className="relative"><input id="signup-password" className={`${field} pr-14`} type={showPassword ? "text" : "password"} required minLength={8} maxLength={128} value={registration.password} onChange={(event) => setRegistration({ ...registration, password: event.target.value })} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} className="absolute bottom-1 right-1 grid h-11 w-11 place-items-center text-slate-500" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>
                  </label>
                  <label className="block text-sm font-semibold" htmlFor="signup-confirm">Confirm password
                    <div className="relative"><input id="signup-confirm" className={`${field} pr-14`} type={showConfirm ? "text" : "password"} required minLength={8} maxLength={128} value={registration.confirm} onChange={(event) => setRegistration({ ...registration, confirm: event.target.value })} /><button type="button" aria-label={showConfirm ? "Hide password" : "Show password"} className="absolute bottom-1 right-1 grid h-11 w-11 place-items-center text-slate-500" onClick={() => setShowConfirm((value) => !value)}>{showConfirm ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>
                  </label>
                  <p className="text-xs leading-5 text-slate-500 dark:text-slate-300">At least 8 characters.</p>
                </>}
                {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
                <button type="submit" disabled={busy} className={primary}>{signupStep === 1 ? "Continue" : busy ? "Creating account…" : "Create account"}</button>
                <p className="text-sm text-slate-600 dark:text-slate-300">Already have an account? <button type="button" className="min-h-10 font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={() => { setView("login"); setError(""); setShowPassword(false); }}>Log in</button></p>
              </form>
            )}
            {view === "forgot" && <form onSubmit={(event) => { event.preventDefault(); setView("sent"); }} className="space-y-5"><label className="block text-sm font-semibold" htmlFor="reset-email">Email<input id="reset-email" className={field} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><button className={primary}>Request password reset</button><p className="text-sm text-slate-500 dark:text-slate-300">Demo only. No email will be sent.</p><button type="button" onClick={() => setView("login")} className="min-h-11 text-sm font-medium text-violet-700 dark:text-violet-300">Back to login</button></form>}
            {view === "sent" && <div><Check className="mb-6 text-violet-600" size={32} /><button className={primary} onClick={() => { setView("login"); setPassword(""); }}>Back to login</button></div>}
          </div>
        </section>
      </div>
    </main>
  );
}

export function AccountControls({ user, onUserChange, onLogout }: { user: UserProfile; onUserChange: (user: UserProfile) => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState(user.fullName);
  const [draftPhone, setDraftPhone] = useState(user.phone ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const initials = user.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "AB";

  useEffect(() => {
    setDraftName(user.fullName);
    setDraftPhone(user.phone ?? "");
  }, [user.fullName, user.phone]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!draftName.trim()) { setError("Enter your full name."); return; }
    if (draftPhone && !validPhone(draftPhone.trim())) { setError("Enter a valid phone number with 10–15 digits."); return; }
    setBusy(true);
    const result = await updateCurrentUser({ fullName: draftName.trim(), phone: draftPhone.trim() || null });
    setBusy(false);
    if (!result.success || !result.user) { setError(result.error ?? "Could not update the account."); return; }
    onUserChange(result.user);
    setOpen(false);
  };

  return <>
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><button type="button" aria-label={`Account menu for ${user.fullName}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-white bg-violet-600 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:scale-105 hover:bg-violet-700 dark:border-slate-600">{initials}</button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={10} className="w-64 rounded-2xl border-slate-200 bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-[#1B2133] dark:text-white">
        <DropdownMenuLabel className="px-3 py-3"><p className="truncate text-base font-semibold">{user.fullName}</p><p className="truncate text-sm font-normal text-slate-500 dark:text-slate-300">{user.email}</p></DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="rounded-lg px-3 py-3 text-sm" onSelect={() => { setDraftName(user.fullName); setDraftPhone(user.phone ?? ""); setError(""); setOpen(true); }}><UserRound size={18} />Manage account</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="rounded-lg px-3 py-3 text-sm text-red-600 dark:text-red-400" onSelect={onLogout}><LogOut size={18} />Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl bg-white text-slate-900 dark:bg-[#1B2133] dark:text-white">
        <DialogHeader><DialogTitle>Manage account</DialogTitle><DialogDescription>Update your name and phone number. Your university email is managed by TSM.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          <label className="block text-sm font-semibold" htmlFor="profile-name">Name<input id="profile-name" className={field} required maxLength={80} value={draftName} onChange={(event) => setDraftName(event.target.value)} /></label>
          <label className="block text-sm font-semibold" htmlFor="profile-phone">Phone number<input id="profile-phone" className={field} type="tel" autoComplete="tel" maxLength={30} placeholder="Enter your phone number" value={draftPhone} onChange={(event) => setDraftPhone(event.target.value)} /></label>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
          <button type="submit" disabled={busy} className={primary}>{busy ? "Saving…" : "Save changes"}</button>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
