/** permissionTemplates namespace (en) — R14 W2: job-title permission templates, individual overrides, carrier authorization. */
const permissionTemplatesEn = {
  source: {
    inherited: "Inherited from job title",
    grant: "Individual grant",
    deny: "Individual deny",
    alsoInherited: "also inherited",
  },
  state: {
    label: "Permission source",
    inherit: "Inherit",
    grant: "Grant",
    deny: "Deny",
  },
  actions: {
    assignCarrier: "Assign carrier & tracking",
    managePermissions: "Manage permissions",
  },
  userPanel: {
    inheritsFrom: "Inherits the default permissions of “{title}”.",
    noJobTitle: "No job title — only individual grants apply.",
    reviewRequired:
      "The job title changed. Review the individual grants and denies, then save to clear this flag.",
    selfEdit: "You cannot edit your own individual permissions.",
    readOnly: "Read only — changing permissions needs the “Manage permissions” right.",
    summary: "{grants} individual grants · {denies} individual denies",
  },
  reviewBadge: "Review permissions",
  jobTitle: {
    action: "Default permissions",
    title: "Default permissions — {name}",
    description: "Applies immediately to every user holding this job title ({count}).",
    seedFromUser: "Start from a user",
    seedLoad: "Load grants",
    seeded: "The user's grants were loaded — review, then save.",
    reviewImpact: "Review impact",
    back: "Back",
    confirmSave: "Save and apply",
    impactSummary: "{added} added · {removed} removed · {affected} of {holders} users change",
    noImpact: "No user's effective permissions change.",
    columnUser: "User",
    columnGained: "Gains",
    columnLost: "Loses",
    columnIneffective: "Not effective because of",
    ineffectiveDenied: "{permission} — individually denied",
    ineffectiveGranted: "{permission} — individually granted",
    saved: "Default permissions saved and applied to {count} users.",
    noChanges: "There are no changes to save.",
    readOnly: "Read only — editing defaults needs the “Manage permissions” right.",
  },
  shipping: {
    carrierReadOnly:
      "Carrier and tracking number are read only — assigning them needs the “Assign carrier & tracking” permission.",
  },
} as const;

export default permissionTemplatesEn;
