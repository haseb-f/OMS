# UI Guardian

Owns 100% of OMS UI & UX. Every UI task MUST load this Guardian. If any rule
is violated, the task is NOT complete.

==========================================================
Design Philosophy
==========================================================

- Enterprise ERP.
- Inspired by: Linear, Stripe, GitHub, Notion, Microsoft Clarity.
- Workflow inspiration: Odoo.
- Never copy UI. Only adopt UX principles.
- Enterprise First. Beauty Second.
- Speed First. Consistency First.

==========================================================
Core Principles
==========================================================

- Compact UI.
- High information density.
- No wasted space.
- No oversized controls.
- Fast data entry.
- Keyboard friendly.
- Reduce scrolling.
- Reduce clicks.
- Reduce mouse movement.
- Every pixel must provide value.
- Professional users use this system 8+ hours/day.

==========================================================
Global Design System
==========================================================

One shared component only for: Button, Input, Textarea, Select, Dropdown,
Search, Calendar, Date Range Picker, Table, Toolbar, Filter Bar, Dialog,
Card, Tabs, Pagination, Status Badge, Empty State, Loading Skeleton,
Breadcrumb, Header, Stat Card, Upload, Checkbox, Radio, Switch, Toast.

- Never create duplicates.
- Never create page-specific variants.

==========================================================
Component Rules
==========================================================

- Everything defaults to Compact.
- One Radius.
- One Shadow.
- One Border.
- One Font Scale.
- One Icon Set — Lucide only.
- RTL First.
- Arabic First.

==========================================================
Buttons
==========================================================

- Variants: Primary, Secondary, Ghost, Danger, Icon.
- Same height.
- Same padding.
- Same radius.

==========================================================
Forms
==========================================================

- Never full-width.
- Logical groups.
- Equal spacing.
- Aligned labels.
- Validation below field.
- Primary action always visible.

==========================================================
Tables
==========================================================

- Sticky header.
- Compact rows.
- Resizable columns.
- Sortable.
- Filterable.
- Export.
- Print.
- Bulk actions.
- Selection.
- Fixed action column.
- No wrapped numbers.
- Aligned amounts.
- Aligned dates.

==========================================================
Filter Toolbar
==========================================================

- One line.
- Compact.
- Order: Search, Status, Date, Actions.
- Same order everywhere.

==========================================================
Dropdowns
==========================================================

- One shared component.
- Search.
- Compact.
- Single-line items.
- RTL.
- Keyboard.
- Scrollable.
- Equal row height.
- Never wrap labels.

==========================================================
Date Picker
==========================================================

- One shared component.
- Compact.
- Single calendar.
- Quick ranges.
- Entire trigger clickable.
- Apply button.
- Cancel button.
- Minimal whitespace.
- No duplicated arrows.
- No duplicated controls.
- RTL.

==========================================================
Dialogs
==========================================================

- Fit content.
- No oversized dialogs.
- Sticky footer.
- Compact spacing.
- Primary action.
- Secondary action.

==========================================================
Cards
==========================================================

- Equal padding.
- Equal radius.
- Equal spacing.
- Equal headers.

==========================================================
Empty States
==========================================================

- Illustration.
- Title.
- Description.
- Primary action.

==========================================================
Loading
==========================================================

- Skeleton.
- Avoid spinners.

==========================================================
Typography
==========================================================

- One font.
- One scale.
- No random sizes.

==========================================================
Forbidden
==========================================================

- Different Dropdowns.
- Different Calendars.
- Different Toolbars.
- Different Tables.
- Different Dialogs.
- Different Buttons.
- Large Empty Spaces.
- Oversized Inputs.
- Oversized Cards.
- Centered CRUD layouts.
- Duplicated Components.
- Decorative UI.
- Random Margins.
- Random Padding.

==========================================================
Self Review
==========================================================

Before every UI task verify:

- Shared Components ✔
- Compact ✔
- RTL ✔
- No Empty Space ✔
- No Duplicate Components ✔
- Unified Tables ✔
- Unified Forms ✔
- Unified Calendar ✔
- Unified Dropdown ✔
- Unified Toolbar ✔
- Keyboard Friendly ✔
- Enterprise UX ✔

If any check fails: fix automatically. Never return until all checks pass.
