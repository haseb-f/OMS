/** tableViews namespace (en) - R7 A: density control, Table/Grid switch, grid cards, "new to you". */
const tableViewsEn = {
  density: {
    label: "Row density",
    current: "Row density: {value}",
    compact: "Compact",
    comfortable: "Comfortable",
    compactHint: "More rows on screen",
    comfortableHint: "More room per row",
  },
  view: {
    label: "View",
    table: "Table view",
    grid: "Grid view",
  },
  sort: {
    label: "Sort by",
    ascending: "Ascending",
    descending: "Descending",
  },
  card: {
    nextAction: "Next:",
    selectRow: "Select {name}",
    actions: "Actions",
    newToYou: "New to you",
    newToYouHint: "You have not opened this lead yet",
  },
  leadNext: {
    ASSIGN: "Assign to an employee",
    CONVERT: "Convert to an order",
    FOLLOW_UP_OVERDUE: "Follow-up overdue",
    FOLLOW_UP_TODAY: "Follow-up today",
    FOLLOW_UP_TOMORROW: "Follow-up tomorrow",
    FOLLOW_UP_LATER: "Follow-up {date}",
    FIRST_CONTACT: "Make first contact",
    SCHEDULE_FOLLOW_UP: "Schedule a follow-up",
  },
} as const;

export default tableViewsEn;
