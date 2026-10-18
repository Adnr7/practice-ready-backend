"use client";

export function LoginAtmosphere() {
  return (
    <>
      <style>{`
        [class*="hover:"], [class*="group-hover:"] { transition-duration: 60ms !important; }
        @keyframes practice-ready-equalizer { 0%,100%{transform:scaleY(.72)} 18%{transform:scaleY(1.08)} 38%{transform:scaleY(.86)} 58%{transform:scaleY(1.18)} 78%{transform:scaleY(.94)} }
        @keyframes practice-ready-wave-drift-a { 0%,100%{transform:translate3d(-4.5%,-1.5%,0) scale(1.035)} 50%{transform:translate3d(4.5%,2%,0) scale(1.09)} }
        @keyframes practice-ready-wave-drift-b { 0%,100%{transform:translate3d(4%,2%,0) scale(1.075)} 50%{transform:translate3d(-4.5%,-2%,0) scale(1.025)} }
        @keyframes practice-ready-wave-breathe { 0%,100%{opacity:.82} 50%{opacity:1} }
        .practice-ready-eq-bar{transform-origin:center bottom;animation:practice-ready-equalizer ease-in-out infinite;backface-visibility:hidden;transform:translateZ(0);will-change:transform}
        .practice-ready-wave-field{background:rgba(245,243,255,.72);animation:practice-ready-wave-breathe 6.8s ease-in-out infinite;contain:paint;isolation:isolate;transform:translateZ(0);will-change:opacity}
        html.dark .practice-ready-wave-field{background:radial-gradient(circle at 78% 20%,rgba(139,92,246,.14),transparent 36%),radial-gradient(circle at 22% 76%,rgba(99,102,241,.1),transparent 40%),radial-gradient(circle at 52% 48%,rgba(168,85,247,.07),transparent 42%),rgba(22,24,48,.54)}
        .practice-ready-wave-group-a{transform-origin:center;animation:practice-ready-wave-drift-a 9.5s ease-in-out infinite;backface-visibility:hidden;transform:translateZ(0);will-change:transform}
        .practice-ready-wave-group-b{transform-origin:center;animation:practice-ready-wave-drift-b 11s ease-in-out infinite;backface-visibility:hidden;transform:translateZ(0);will-change:transform}
        .practice-ready-wave-band{fill:none;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
        .practice-ready-wave-1{stroke:rgba(196,181,253,.34)} .practice-ready-wave-2{stroke:rgba(221,214,254,.42)} .practice-ready-wave-3{stroke:rgba(167,139,250,.26)} .practice-ready-wave-4{stroke:rgba(233,213,255,.36)} .practice-ready-wave-5{stroke:rgba(192,132,252,.22)} .practice-ready-wave-6{stroke:rgba(216,180,254,.31)} .practice-ready-wave-7{stroke:rgba(196,181,253,.25)}
        html.dark .practice-ready-wave-1{stroke:rgba(139,92,246,.17)} html.dark .practice-ready-wave-2{stroke:rgba(184,160,255,.19)} html.dark .practice-ready-wave-3{stroke:rgba(192,132,252,.16)} html.dark .practice-ready-wave-4{stroke:rgba(129,140,248,.14)} html.dark .practice-ready-wave-5{stroke:rgba(216,180,254,.14)} html.dark .practice-ready-wave-6{stroke:rgba(174,151,246,.16)} html.dark .practice-ready-wave-7{stroke:rgba(147,91,219,.13)}
        @keyframes practice-ready-panel-breathe{0%,100%{transform:scale(1);opacity:.82}50%{transform:scale(1.07);opacity:1}}
        .practice-ready-panel-ambient{transform-origin:center;animation:practice-ready-panel-breathe 16s ease-in-out infinite;will-change:transform,opacity}
        @media (prefers-reduced-motion: reduce){.practice-ready-eq-bar,.practice-ready-wave-field,.practice-ready-wave-group-a,.practice-ready-wave-group-b,.practice-ready-panel-ambient{animation:none!important}}
      `}</style>
      <div className="practice-ready-wave-field pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <svg className="absolute -left-[12%] -top-[10%] h-[120%] w-[124%]" viewBox="0 0 1200 900" preserveAspectRatio="none">
          <g className="practice-ready-wave-group-a"><path className="practice-ready-wave-band practice-ready-wave-1" strokeWidth="280" d="M-220 40 C80 -85 260 150 520 70S930 -40 1420 120"/><path className="practice-ready-wave-band practice-ready-wave-3" strokeWidth="255" d="M-220 330 C70 195 300 455 555 340S960 185 1420 365"/><path className="practice-ready-wave-band practice-ready-wave-5" strokeWidth="270" d="M-210 630 C110 480 325 750 590 625S995 470 1400 665"/><path className="practice-ready-wave-band practice-ready-wave-7" strokeWidth="250" d="M-190 900 C120 760 360 1000 640 880S1040 750 1380 900"/></g>
          <g className="practice-ready-wave-group-b"><path className="practice-ready-wave-band practice-ready-wave-2" strokeWidth="250" d="M-210 190 C95 60 280 285 535 195S940 65 1410 235"/><path className="practice-ready-wave-band practice-ready-wave-4" strokeWidth="265" d="M-215 475 C90 340 315 600 575 485S985 325 1410 515"/><path className="practice-ready-wave-band practice-ready-wave-6" strokeWidth="255" d="M-200 770 C115 620 350 885 620 760S1020 610 1390 790"/></g>
        </svg>
      </div>
    </>
  );
}

export function LoginEqualizer() {
  const bars = [28, 46, 64, 38, 74, 52, 34, 68, 44, 58, 30, 50];
  return <div className="relative flex h-24 items-end gap-2" aria-hidden="true">{bars.map((height, index) => <span key={index} className="practice-ready-eq-bar w-3 rounded-full bg-gradient-to-t from-violet-500 to-orange-300" style={{ height, animationDuration: `${1.7 + (index % 5) * .28}s`, animationDelay: `${-.16 * index}s` }}/>)}</div>;
}
