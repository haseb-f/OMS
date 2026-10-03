/** leadOps namespace (en) — R6 spec C: follow-up classification + the distribution status button/dialog. */
const leadOpsEn = {
  userFlag: {
    label: "Sales employee (receives leads)",
    hint: "Only designated sales employees can receive distributed or manually assigned leads. Finance, shipping and HR staff stay off unless you turn this on. They also need the lead-handling permission.",
  },
  outcome: {
    label: "Follow-up classification",
    none: "No classified outcome",
    all: "All classifications",
    recordedAt: "Last outcome: {time}",
  },
  distribution: {
    button: {
      active: "Distribution active",
      activeUntil: "Distribution active until {time}",
      paused: "Distribution paused",
      manual: "Distribution manual",
      blocked: "Distribution blocked",
      pending: "{count} pending",
      loading: "Loading distribution status…",
      unavailable: "Distribution status unavailable",
      retry: "Retry",
      busy: "Distributing…",
    },
    dialog: {
      title: "Lead distribution",
      description:
        "Choose a mode, then confirm — selecting only previews; nothing is sent before you confirm.",
      current: "Current mode",
      eligible: "Eligible employees",
      pending: "Pending",
      held: "of which held",
      scope: "Scope",
      scopeCompany: "Whole company",
      scopeTeam: "Team {name}",
      modes: "Modes",
      currentTag: "Current",
      previewUnchanged: "This is the current mode — nothing to save.",
      previewAuto:
        "On confirm the mode is saved and {pending} pending leads are distributed now across {eligible} employees in rotation, then each new lead as it is created.",
      previewAutoRerun:
        "On confirm the unowned leads are distributed again now ({pending}). Owned leads are never reassigned.",
      previewHours:
        "Stays active for 24 hours from confirmation, then stops. There is no scheduled run: distribution happens on confirm and when each lead is created.",
      previewNoEligible:
        "No eligible employees — the mode will be saved but no lead is assigned until an employee is available.",
      previewManual:
        "No automatic assignment: leads are assigned manually. Current ownership stays.",
      previewPaused:
        "Stops all automatic assignment. New leads wait for distribution; current ownership stays.",
      confirm: "Confirm",
      confirmRun: "Confirm and distribute now",
      running: "Saving and distributing…",
      saving: "Saving…",
      close: "Close",
      resultAssigned: "Assigned {assigned} leads. {pending} still pending ({held} held).",
      resultNoAuto: "Saved: {mode} — no automatic assignment.",
      resultActiveUntil: "Active until {time}.",
      resultFailed: "No lead was assigned ({code}): {reason}",
    },
    pool: {
      title: "Recipients",
      eligible: "Eligible ({count})",
      excluded: "Excluded ({count})",
      show: "Show recipients",
      hide: "Hide recipients",
      noneEligible: "No eligible sales employees.",
      noneExcluded: "No excluded users.",
      truncated: "Only the first {count} excluded users are shown.",
      rule: "A recipient must be an active, unlocked sales employee holding the lead-handling permission.",
      reasons: {
        AGENT_USER: "Agent user",
        DELETED: "Deleted",
        INACTIVE: "Inactive",
        LOCKED: "Locked",
        ON_LEAVE: "On leave / inactive employment",
        TERMINATED: "Employment terminated",
        NO_PERMISSION: "No lead permission",
        NOT_SALES_DESIGNATED: "Not designated as sales",
        WRONG_TEAM: "Not in the selected team",
        WRONG_DEPARTMENT: "Not in the selected department",
      },
    },
  },
} as const;

export default leadOpsEn;
