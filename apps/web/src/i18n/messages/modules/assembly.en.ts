/** assembly namespace (en) - R13: assembly orders of assembled products (list, new assembly, detail, reversal). */
const assemblyEn = {
  title: "Assembly orders",
  description:
    "Assemble products from their active recipe: components are consumed at their average cost and the finished item is received in one step.",
  referenceLabel: "Assembly order",
  newAssembly: "New assembly",
  assembleAction: "Assemble",
  empty: "No assembly orders yet.",
  fields: {
    number: "Assembly No.",
    date: "Date",
    product: "Product",
    warehouse: "Warehouse",
    quantity: "Quantity",
    unitCost: "Unit cost",
    totalCost: "Total cost",
    componentCost: "Components cost",
    directCost: "Direct cost",
    status: "Status",
    recipeVersion: "Recipe version",
    notes: "Notes",
    component: "Component",
    needed: "Needed",
    available: "Available",
    consumed: "Consumed",
    value: "Value",
    movement: "Movement",
    owner: "Owner",
    reversedAt: "Reversed on",
    reversedBy: "Reversed by",
    reversalReason: "Reversal reason",
  },
  status: {
    POSTED: "Posted",
    REVERSED: "Reversed",
  },
  versionLabel: "Version {version}",
  dialog: {
    title: "New assembly",
    description:
      "Pick an assembled product, the warehouse and the quantity — the components needed are shown before anything is posted.",
    productPlaceholder: "Select an assembled product",
    noAssembledProducts: "No active assembled products.",
    quantityInvalid: "Enter a whole quantity greater than zero.",
    directCostLabel: "Direct cost (labour / overhead)",
    directCostHint:
      "An approved cost for this order only; it is added to the finished item's cost.",
    directCostInvalid: "Enter a positive amount with at most two decimals.",
    notesPlaceholder: "Optional",
    submit: "Assemble",
    previewTitle: "Components needed",
    previewHint: "Pick the product, warehouse and quantity to see what will be consumed.",
    previewLoading: "Working out the components…",
    previewFailed: "The components could not be worked out.",
    limiting: "Limiting component",
    shortBy: "Short {count}",
    maximum: "Maximum possible now: {count}",
    useMaximum: "Use maximum",
    blockersTitle: "Cannot assemble yet",
    estimatedUnitCost: "Estimated unit cost",
    estimatedComponents: "Components cost (estimate)",
    estimatedDirect: "Recipe direct cost estimate",
    estimateNote:
      "Estimated from the components' current average cost; the actual cost is fixed when the assembly is posted.",
    agentOwnedNote:
      "Agent-owned stock: only movements and the cost snapshot are recorded — nothing is posted to the company ledger.",
  },
  success: {
    created: "Assembly {number} posted",
    createdDescription: "{quantity} × {product} received into {warehouse}.",
    open: "Open assembly",
    reversed: "Assembly {number} reversed",
  },
  detail: {
    title: "Assembly order",
    summary: "Assembly summary",
    lines: "Consumed components",
    totals: "Cost",
    output: "Finished item",
    outputMovement: "Finished item receipt",
    reversal: "Reversal",
    costHidden: "Cost figures are not visible with your permissions.",
    agentOwnedNote: "Agent-owned stock: no journal was posted to the company ledger.",
    viewMovements: "View movements",
  },
  reverse: {
    action: "Reverse assembly",
    title: "Reverse assembly {number}?",
    description:
      "The finished item leaves stock at its recorded cost, every component returns at the unit cost recorded on this order, and the journal entry is reversed. Nothing is deleted.",
    condition:
      "Only possible while the finished quantity ({quantity}) is still available in {warehouse}.",
    reasonLabel: "Reason (required)",
    reasonPlaceholder: "Why is this assembly being reversed?",
    confirm: "Reverse assembly",
  },
  errors: {
    ASSEMBLY_INSUFFICIENT_STOCK: "Not enough component stock in this warehouse.",
    shortageItem: "{name}: needs {required}, available {available}",
    listSeparator: "; ",
    ASSEMBLY_NO_ACTIVE_RECIPE: "This product has no active recipe — activate one first.",
    ASSEMBLY_NOT_ASSEMBLED_PRODUCT:
      "This product is not an active, stock-tracked assembled product.",
    ASSEMBLY_WAREHOUSE_INACTIVE: "The warehouse is inactive.",
    ASSEMBLY_OWNER_MIXED:
      "The product and all its components must have the same owner (the company, or the same agent).",
    ASSEMBLY_FRACTIONAL_CONSUMPTION:
      "This quantity would consume a fraction of a component — choose a quantity that gives whole stock units.",
    RECIPE_UNIT_CONVERSION_MISSING:
      "There is no unit conversion between the recipe unit and the component's stock unit.",
    ASSEMBLY_COST_ACCOUNT_MISSING:
      "A direct cost needs the Assembly cost account — set it in Accounting Settings first.",
    ASSEMBLY_DIRECT_COST_FORBIDDEN:
      "Entering a direct cost requires the assembly direct-cost permission.",
    ASSEMBLY_AGENT_DIRECT_COST: "Agent-owned stock is assembled without a direct cost.",
    ASSEMBLY_IDEMPOTENCY_MISMATCH:
      "A different assembly was already sent with this request key — close the dialog and start again.",
    ASSEMBLY_RECIPE_CHANGED:
      "The recipe changed while the assembly was being prepared — review the components and try again.",
    ASSEMBLY_OUTPUT_CONSUMED:
      "The finished item is no longer in stock — use the scrap or return flows instead of reversing.",
    ASSEMBLY_OUTPUT_CONSUMED_DETAIL:
      "Cannot reverse: {required} finished units must leave stock but only {available} are available — they were sold or used. Use the scrap or return flows instead.",
    ASSEMBLY_NOT_POSTED: "This assembly is already reversed.",
    ASSEMBLY_NOT_FOUND: "The assembly order does not exist.",
    INVENTORY_DUPLICATE_MOVEMENT: "This movement was already recorded — nothing was duplicated.",
  },
};

export default assemblyEn;
