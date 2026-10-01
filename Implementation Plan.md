# Implementation Plan: Modernize Modal UI Design

Redesign the modals across **Distributions** and **Relief Registry** to match the modern design standard established by the *Schedule a Barangay Relief Distribution* modal (Image 1).

## Scope of Work

The three modals to be redesigned:
1. **Distributions > Manage > View Details** ([`DistributionDetailsModal.tsx`](file:///c:/Users/Emmanuel%20De%20Vera/Desktop/kapit-bisig/apps/web/apps/src/components/distribution/DistributionDetailsModal.tsx))
2. **Distributions > Manage > View Households** ([`ViewHouseholdsModal.tsx`](file:///c:/Users/Emmanuel%20De%20Vera/Desktop/kapit-bisig/apps/web/apps/src/components/distribution/ViewHouseholdsModal.tsx))
3. **Relief Registry > View Record** ([`HouseholdProfileModal.tsx`](file:///c:/Users/Emmanuel%20De%20Vera/Desktop/kapit-bisig/apps/web/apps/src/components/households/HouseholdProfileModal.tsx))

---

## Design System Specifications (Derived from Image 1 / `NewDistributionModal`)

All redesigned modals will consistently feature:
- **Backdrop & Layering**: `fixed inset-0 z-[120]` with `bg-black/45 backdrop-blur-sm` and smooth animations.
- **Top Accent Line**: `h-1.5 overflow-hidden` featuring the signature gradient `bg-gradient-to-r from-emerald-500 via-teal-500 to-[#0F533A]`.
- **Card Container**: `rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 shadow-2xl` with responsive sizing (`max-w-2xl` / `max-w-3xl`) and `max-h-[92vh]`.
- **Header Structure**:
  - Live/Category pill badge: `px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-[#0F533A] dark:text-emerald-400 text-[11px] font-bold uppercase tracking-wider border border-emerald-200/60 dark:border-emerald-800/40` with animated/pulsing indicator.
  - Title: Large, bold `text-xl sm:text-2xl font-black text-gray-900 dark:text-slate-100 tracking-tight`.
  - Subtitle: Clear helper text `text-xs sm:text-sm text-gray-500 dark:text-slate-400`.
  - Close button: `rounded-xl border border-gray-200 dark:border-slate-700 p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800`.
- **Hero & Content Sections**:
  - Rounded section containers: `rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4`.
  - Modern stat/metric cards with clean typography and badge indicators.
  - Interactive cards with refined hover states (`hover:border-emerald-500/40 hover:bg-emerald-50/20`).
- **Footer**:
  - `border-t border-gray-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-end gap-3`.
  - Secondary button: `rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200`.
  - Primary button: `rounded-xl bg-[#0F533A] hover:bg-[#0c4430] text-white px-5 py-2.5 text-sm font-bold shadow-md shadow-emerald-900/20`.

---

## Detailed Task Breakdown

### Task 1: Redesign `ViewHouseholdsModal.tsx`
- **File**: [`apps/web/apps/src/components/distribution/ViewHouseholdsModal.tsx`](file:///c:/Users/Emmanuel%20De%20Vera/Desktop/kapit-bisig/apps/web/apps/src/components/distribution/ViewHouseholdsModal.tsx)
- **Changes**:
  1. Add top emerald gradient bar and update outer wrapper to `max-w-3xl rounded-3xl shadow-2xl`.
  2. Modernize the header with uppercase tracking badge (`LIVE TELEMETRY • ACTIVE CLAIM RUN`), host barangay label, refresh button with rotating loading state, and rounded-xl close button.
  3. Redesign the 3 summary metric cards (Eligible/Registered, Claimed, Not Yet Claimed) using `rounded-2xl` cards with icons, uppercase labels, and bold numbers.
  4. Redesign search input with search icon, clear button, and character limit.
  5. Upgrade tabs switcher to modern pill tabs with count badges.
  6. Redesign household item cards:
     - Avatar/family head initial icon.
     - Household name, mono household ID badge, barangay tag, and address.
     - Claim details section for claimed items (proof method badge, scanned by, timestamp).
  7. Upgrade pagination controls with clean styling matching the design system.
  8. Modernize empty states and loading/error states.

### Task 2: Redesign `DistributionDetailsModal.tsx`
- **File**: [`apps/web/apps/src/components/distribution/DistributionDetailsModal.tsx`](file:///c:/Users/Emmanuel%20De%20Vera/Desktop/kapit-bisig/apps/web/apps/src/components/distribution/DistributionDetailsModal.tsx)
- **Changes**:
  1. Add top emerald gradient bar and expand container to `max-w-2xl rounded-3xl shadow-2xl`.
  2. Modernize header with lifecycle status pill (`ACTIVE`, `UPCOMING`, `COMPLETED`), title (`Distribution Operations Details`), and host barangay.
  3. Create a hero overview banner showing:
     - Relief distribution scope (`General Relief` vs `Targeted Proof Required`)
     - Venue / Location with pin icon
     - Host Barangay
  4. Redesign the details sections:
     - Scheduled timing card with calendar icon, start/end dates and duration.
     - Beneficiary / household target metrics card with icon and progress status.
     - Logistics & assigned staff section with staff avatars, role chips, and covered barangays.
     - Notes card with quote styling if present.
     - Archive / completion details card if present.
  5. Modernize footer with clean "Close" button and green "Mark as Completed" button with check icon.

### Task 3: Redesign `HouseholdProfileModal.tsx`
- **File**: [`apps/web/apps/src/components/households/HouseholdProfileModal.tsx`](file:///c:/Users/Emmanuel%20De%20Vera/Desktop/kapit-bisig/apps/web/apps/src/components/households/HouseholdProfileModal.tsx)
- **Changes**:
  1. Add top emerald gradient bar and update container to `max-w-2xl rounded-3xl shadow-2xl`.
  2. Modernize header with pill badge (`RELIEF REGISTRY • BENEFICIARY RECORD`), family head name with verified badge icon, and rounded-xl close button.
  3. Hero overview card with mono Registry Household Code, copy button/feedback, and family size badge (`X Persons`).
  4. Modern information cards:
     - Residence & Contact details (full address with map pin icon, contact phone with phone icon, barangay).
     - Distribution Claim Status card (current claim status pill, latest assistance timestamp, distribution cycle name).
     - Registration metadata card (registered date and verification state).
  5. Modernize footer with clean "Close" button.

---

## Verification Plan

1. **Static Analysis & Type Checking**:
   - Run `npx tsc --noEmit` in `apps/web/apps` to guarantee no TypeScript errors.
2. **Visual & Behavioral Checks**:
   - Verify modal opening/closing animations and backdrops.
   - Verify live refresh and tab switching in `ViewHouseholdsModal`.
   - Verify staff rendering and "Mark as Completed" action in `DistributionDetailsModal`.
   - Verify household information and status tags in `HouseholdProfileModal`.
   - Verify dark mode contrast and responsive behavior across mobile/tablet/desktop.
