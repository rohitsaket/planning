export type LiveFieldType = "string" | "decimal" | "boolean" | "date";

export interface LiveLotFieldSpec {
  header: string;
  field: LiveLotFieldKey;
  source: string[];
  type: LiveFieldType;
  transform: string;
  numeric?: boolean;
}

export type LiveLotFieldKey =
  | "metalId" | "metalWeight" | "previousDepartmentAccountName" | "processName" | "remark" | "qty"
  | "lotId" | "lotName" | "onHold" | "lotStatusDb" | "shape" | "color" | "clarity" | "size" | "weight"
  | "labName" | "certificateNo" | "cut" | "polish" | "symmetry" | "fluorescence" | "m1" | "m2" | "m3"
  | "tablePercent" | "depthPercent" | "ratio" | "tone" | "departmentAccountName" | "estimatedClarityId"
  | "estimatedColorId" | "averageWeight" | "allocationDate" | "allocationAccountId" | "certificateId"
  | "companyId" | "docId" | "estimatedShapeId" | "estimatedWeight" | "fancyColor" | "metalColor"
  | "metalWgt" | "originalWeight" | "totalDiamondWeight" | "docDate" | "itemName";

const S = "trim; empty → null";
const D = "decimal string, commas removed, precision preserved; non-numeric → null + warning";
const B = "1/true/Y/Yes → true, 0/false/N/No → false; other → null + warning";
const T = "ISO, /Date(ms)/, dd-MM-yyyy, dd/MM/yyyy HH:mm; unparseable → null + warning";

export const LIVE_LOT_FIELDS: LiveLotFieldSpec[] = [
  { header: "Metal ID", field: "metalId", source: ["Metal ID", "MetalID"], type: "string", transform: S },
  { header: "Metal Wgt", field: "metalWeight", source: ["Metal Wgt", "MetalWgt", "Metal Weight"], type: "decimal", transform: D, numeric: true },
  { header: "Previous Department Account Name", field: "previousDepartmentAccountName", source: ["Previous Department Account Name", "Previous Department Account", "PreviousDepartmentAccountName", "PrevDepartmentAccountName"], type: "string", transform: S },
  { header: "Process Name", field: "processName", source: ["Process Name", "ProcessName"], type: "string", transform: S },
  { header: "Remark", field: "remark", source: ["Remark", "Remarks"], type: "string", transform: S },
  { header: "Qty", field: "qty", source: ["Qty", "Quantity"], type: "decimal", transform: D, numeric: true },
  { header: "Lot ID", field: "lotId", source: ["Lot ID", "LotID", "LotId"], type: "string", transform: S },
  { header: "Lot Name", field: "lotName", source: ["Lot Name", "LotName"], type: "string", transform: S },
  { header: "On Hold", field: "onHold", source: ["On Hold", "OnHold", "IsOnHold"], type: "boolean", transform: B },
  { header: "Lot Status DB", field: "lotStatusDb", source: ["Lot Status DB", "LotStatusDB", "LotStatusDb", "Lot Status"], type: "string", transform: S },
  { header: "Shape", field: "shape", source: ["Shape", "ShapeName"], type: "string", transform: S },
  { header: "Color", field: "color", source: ["Color", "Colour"], type: "string", transform: S },
  { header: "Clarity", field: "clarity", source: ["Clarity"], type: "string", transform: S },
  { header: "Size", field: "size", source: ["Size", "SizeName"], type: "string", transform: S },
  { header: "Weight", field: "weight", source: ["Weight", "Wgt", "Carat"], type: "decimal", transform: D, numeric: true },
  { header: "Lab Name", field: "labName", source: ["Lab Name", "LabName", "Lab"], type: "string", transform: S },
  { header: "Certificate No", field: "certificateNo", source: ["Certificate No", "CertificateNo", "Certificate Number", "CertNo"], type: "string", transform: S },
  { header: "Cut", field: "cut", source: ["Cut"], type: "string", transform: S },
  { header: "Polish", field: "polish", source: ["Polish"], type: "string", transform: S },
  { header: "Symm", field: "symmetry", source: ["Symm", "Sym", "Symmetry"], type: "string", transform: S },
  { header: "Fluo.", field: "fluorescence", source: ["Fluo.", "Fluo", "Fluorescence", "Flour"], type: "string", transform: S },
  { header: "M1", field: "m1", source: ["M1"], type: "decimal", transform: D, numeric: true },
  { header: "M2", field: "m2", source: ["M2"], type: "decimal", transform: D, numeric: true },
  { header: "M3", field: "m3", source: ["M3"], type: "decimal", transform: D, numeric: true },
  { header: "Table", field: "tablePercent", source: ["Table", "TablePercent", "Table %"], type: "decimal", transform: D, numeric: true },
  { header: "Depth", field: "depthPercent", source: ["Depth", "DepthPercent", "Depth %"], type: "decimal", transform: D, numeric: true },
  { header: "Ratio", field: "ratio", source: ["Ratio"], type: "decimal", transform: D, numeric: true },
  { header: "Tone", field: "tone", source: ["Tone"], type: "string", transform: S },
  { header: "Department Account Name", field: "departmentAccountName", source: ["Department Account Name", "DepartmentAccountName", "Department"], type: "string", transform: S },
  { header: "Est. Clarity ID", field: "estimatedClarityId", source: ["Est. Clarity ID", "EstClarityID", "Estimated Clarity ID"], type: "string", transform: S },
  { header: "Est. Color ID", field: "estimatedColorId", source: ["Est. Color ID", "EstColorID", "Estimated Color ID"], type: "string", transform: S },
  { header: "Avg Weight", field: "averageWeight", source: ["Avg Weight", "AvgWeight", "Average Weight"], type: "decimal", transform: D, numeric: true },
  { header: "Allocation Date", field: "allocationDate", source: ["Allocation Date", "AllocationDate"], type: "date", transform: T },
  { header: "Allocation Account ID", field: "allocationAccountId", source: ["Allocation Account ID", "AllocationAccountID"], type: "string", transform: S },
  { header: "Certificate ID", field: "certificateId", source: ["Certificate ID", "CertificateID"], type: "string", transform: S },
  { header: "Company ID", field: "companyId", source: ["Company ID", "CompanyID"], type: "string", transform: S },
  { header: "Doc ID", field: "docId", source: ["Doc ID", "DocID", "Document ID"], type: "string", transform: S },
  { header: "Est. Shape ID", field: "estimatedShapeId", source: ["Est. Shape ID", "EstShapeID", "Estimated Shape ID"], type: "string", transform: S },
  { header: "Est. Weight", field: "estimatedWeight", source: ["Est. Weight", "EstWeight", "Estimated Weight"], type: "decimal", transform: D, numeric: true },
  { header: "Fancy Color", field: "fancyColor", source: ["Fancy Color", "FancyColor"], type: "string", transform: S },
  { header: "Metal Color", field: "metalColor", source: ["Metal Color", "MetalColor"], type: "string", transform: S },
  { header: "Met.Wgt", field: "metalWgt", source: ["Met.Wgt", "MetWgt", "Met Wgt"], type: "decimal", transform: D, numeric: true },
  { header: "Original Weight", field: "originalWeight", source: ["Original Weight", "OriginalWeight", "Orig Weight"], type: "decimal", transform: D, numeric: true },
  { header: "Tot.Dia.Wgt", field: "totalDiamondWeight", source: ["Tot.Dia.Wgt", "TotDiaWgt", "Total Diamond Weight", "Tot Dia Wgt"], type: "decimal", transform: D, numeric: true },
  { header: "Doc Date", field: "docDate", source: ["Doc Date", "DocDate", "Document Date"], type: "date", transform: T },
  { header: "ItemName", field: "itemName", source: ["ItemName", "Item Name", "Item"], type: "string", transform: S },
];

export const LIVE_LOT_FIELD_KEYS = LIVE_LOT_FIELDS.map((f) => f.field);

export const LIVE_LOT_SORTABLE = new Set<string>([...LIVE_LOT_FIELD_KEYS, "lastSeenAt", "firstSeenAt", "updatedAt"]);
