"use client";

import { useState } from "react";

interface CollapsibleSectionProps {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  title,
  badge,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2 bg-card border border-border hover:bg-accent/5 transition-colors group"
        style={!open ? { borderBottom: "1px solid var(--color-border)" } : { borderBottom: "none" }}
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-3 h-3 text-muted transition-transform ${open ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-xs font-semibold tracking-wider text-foreground uppercase">
            {title}
          </span>
          {badge && (
            <span className="text-[9px] px-1.5 py-0.5 bg-accent/10 border border-accent/30 text-accent tracking-wider">
              {badge}
            </span>
          )}
        </div>
        <span className="text-[9px] text-muted tracking-wider group-hover:text-foreground">
          {open ? "COLLAPSE" : "EXPAND"}
        </span>
      </button>
      {open && children}
    </div>
  );
}
