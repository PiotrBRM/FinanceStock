// src/App.tsx
import React, { useState, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Download, AlertCircle, CheckCircle, FileText, Search } from "lucide-react";
import * as XLSX from "xlsx";
import Papa from "papaparse";

// ============ EXCLUSION LISTS ============
const EXCLUDED_LABELS = [
  "FREE GOODS",
  "TOMMY BOY RECORDS",
  "PHILLY GROOVE RECORDS",
  "AMHERST RECORDS",
  "RASA MUSIC",
  "RESERVOIR RECORDINGS",
  "RAMBLIN RECORDS",
  "DEF JAM",
  "UNIVERSAL",
  "WARNER",
];
const EXCLUDED_ARTISTS = ["DE LA SOUL", "THE MARSHALL TUCKER BAND", "THE COOL KIDS"];
// =========================================

export default function StockConsolidator() {
  const [source1Data, setSource1Data] = useState<any[]>([]); // Proper CSV
  const [source2Data, setSource2Data] = useState<any[]>([]); // AMPED XLSX
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ data: any[]; count: number; filteredOut: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [properFileName, setProperFileName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [theme] = useState("light");
  const [dragOverTarget, setDragOverTarget] = useState<number | null>(null);
  const fileRef1 = useRef<HTMLInputElement>(null);
  const fileRef2 = useRef<HTMLInputElement>(null);

  // ------------------ FILE READERS ------------------
  const readCSVFile = (file: File) =>
    new Promise<any[]>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        Papa.parse<any>(text, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => resolve(results.data || []),
          error: (err: unknown) => reject(err),
        });
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });

  // Excel reader with smart header detection (works for both AMPED layouts)
  const readExcelFile = (file: File) =>
    new Promise<any[]>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];

          // Peek rows to find header row (Inventory Analysis puts it deeper)
          const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            raw: false,
            defval: "",
          }) as any[][];
          let headerIndex = 0;

          const headerMustHave = [
            ["UPC", "UPC/EAN", "UPC Full", "UPC Code"],
            ["Catalog Num", "Catalog No", "CatalogNo", "Item Code", "Item Number"],
            ["QAV", "Inv Avail", "Inventory Available", "Inventory Qty Available", "QOH", "Qty", "Quantity"],
          ];

          for (let i = 0; i < Math.min(rows.length, 100); i++) {
            const r = (rows[i] || []).map((x) => String(x).trim());
            const hasAllGroups = headerMustHave.every((alts) => alts.some((alt) => r.includes(alt)));
            const hasSalesWeekHints =
              r.includes("Avg/Week") || r.includes("Weekly Avg") || r.includes("CurWeek") || r.includes("Cur Week");
            if (hasAllGroups || (hasSalesWeekHints && r.includes("Inv Avail"))) {
              headerIndex = i;
              break;
            }
          }

          let jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: "", range: headerIndex });

          // Fallback: if bogus keys, skip first line after headerIndex
          if (jsonData.length > 0) {
            const keys = Object.keys(jsonData[0] || {});
            const hasBad = keys.some((k) => k === "" || k.startsWith("_") || k.startsWith("__EMPTY"));
            if (hasBad) {
              jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: "", range: headerIndex + 1 });
            }
          }

          resolve(jsonData || []);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsArrayBuffer(file);
    });

  const handleFile = async (file: File | undefined, target: number) => {
    if (!file) return;
    setError(null);
    try {
      const isExcel = /\.xlsx?$|\.xls$/i.test(file.name);
      const data = isExcel ? await readExcelFile(file) : await readCSVFile(file);
      if (target === 1) {
        setSource1Data(data);
        setProperFileName(file.name);
      } else {
        setSource2Data(data);
      }
    } catch (err) {
      setError(`Error loading ${file?.name || ""}: ${(err as Error).message || String(err)}`);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, target: number) => {
    e.preventDefault();
    setDragOverTarget(null);
    const file = e.dataTransfer?.files?.[0];
    handleFile(file, target);
  };

  // ------------------ HELPERS ------------------
  const getNumericValue = (v: unknown) => {
    if (typeof v === "number") return v || 0;
    if (!v && v !== 0) return 0;
    const s = String(v).replace(/[^0-9.-]/g, "");
    return parseFloat(s) || 0;
  };
  const normalizeBarcode = (barcode: unknown) => {
    if (!barcode && barcode !== 0) return "";
    let s = String(barcode).trim();
    s = s.replace(/^'+/, "").replace(/^0+/, "");
    return s || "0";
  };
  const isExcludedLabel = (label: unknown) => {
    if (!label) return false;
    const s = String(label).toUpperCase();
    return EXCLUDED_LABELS.some((ex) => s.includes(ex));
  };
  const isExcludedArtist = (artist: unknown) => {
    if (!artist) return false;
    const s = String(artist).toUpperCase();
    return EXCLUDED_ARTISTS.some((ex) => s.includes(ex));
  };

  // --- Robust key helpers ---
  const onlyDigits = (s: string) => s.replace(/\D+/g, "");
  const onlyAlnum = (s: string) => s.replace(/[^A-Z0-9]+/gi, "").toUpperCase();

  const normalizeTitle = (v: unknown) =>
    String(v || "")
      .toUpperCase()
      .replace(/[\u2019'’`]/g, "") // quotes
      .replace(/\(.*?\)/g, "") // remove parens content
      .replace(/[^A-Z0-9 ]+/g, " ") // strip punctuation
      .replace(/\s+/g, " ") // collapse spaces
      .trim();

  const normalizeArtist = (v: unknown) =>
    String(v || "")
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const normCat = (v: unknown) => onlyAlnum(String(v || ""));

  // Accept 12/13-digit UPC/EAN and generate common variants (leading 0 added/removed)
  const expandBarcodeVariants = (raw: unknown): string[] => {
    const s = String(raw || "").trim();
    if (!s) return [];
    const digits = onlyDigits(s);
    if (!digits) return [];
    const variants = new Set<string>();
    variants.add(digits);
    if (digits.length === 13 && digits.startsWith("0")) variants.add(digits.slice(1));
    if (digits.length === 12) variants.add("0" + digits);
    variants.add(normalizeBarcode(digits));
    return Array.from(variants);
  };

  // Build a robust AMPED index: by barcode variants, by normalized CatNo, and fallback Artist+Title
  const buildAmpedIndex = (rows: any[]) => {
    const byKey = new Map<string, any>();
    for (const r of rows) {
      const upcRaw =
        r.UPC ||
        r.upc ||
        r.Barcode ||
        r.EAN ||
        r["UPC/EAN"] ||
        r["UPC "] ||
        r["Product UPC/EAN"] ||
        r["UPC Full"] ||
        r["UPC Code"] ||
        "";
      const catRaw =
        r["Catalog Num"] ||
        r.CatNo ||
        r["Catalog No"] ||
        r.CatalogNo ||
        r["Item Code"] ||
        r["Item Number"] ||
        "";

      const variants = expandBarcodeVariants(upcRaw);
      for (const v of variants) byKey.set(`UPC:${v}`, r);

      const nCat = normCat(catRaw);
      if (nCat) byKey.set(`CAT:${nCat}`, r);

      const a = normalizeArtist(r.Artist || r["Artist"] || "");
      const t = normalizeTitle(r.Title || r["Title"] || "");
      if (a && t) byKey.set(`AT:${a}::${t}`, r);
    }
    return byKey;
  };

  // Lookup that tries UPC → CatNo → Artist+Title
  const findAmpedForProper = (idx: Map<string, any>, properRow: any) => {
    const pUPC = properRow.barcode_apostrophe || properRow.Barcode || properRow.UPC || "";
    const upcVariants = expandBarcodeVariants(pUPC);
    for (const v of upcVariants) {
      const hit = idx.get(`UPC:${v}`);
      if (hit) return hit;
    }
    const pCat = normCat(properRow.CatNo || properRow["Catalog No"] || "");
    if (pCat) {
      const hit = idx.get(`CAT:${pCat}`);
      if (hit) return hit;
    }
    const a = normalizeArtist(properRow.Artist);
    const t = normalizeTitle(properRow.Title);
    if (a && t) {
      const hit = idx.get(`AT:${a}::${t}`);
      if (hit) return hit;
    }
    return null;
  };

  // ------------------ PROCESS DATA ------------------
  const processData = () => {
    if (!source1Data.length || !source2Data.length) {
      setError("Please upload both Proper and AMPED files before processing.");
      return;
    }
    setProcessing(true);
    setError(null);

    try {
      // Build AMPED index ONCE (important)
      const ampedIndex = source2Data.length ? buildAmpedIndex(source2Data) : new Map<string, any>();
      // console.log("AMPED index size:", ampedIndex.size);

      const consolidated: any[] = [];

      for (const row of source1Data) {
        if (isExcludedLabel(row.LabelName) || isExcludedLabel(row.SubLabelName)) continue;
        if (isExcludedArtist(row.Artist)) continue;
        if (row.Title && String(row.Title).toUpperCase().includes("DELETED")) continue;

        const stockOnHand = getNumericValue(row.StockOnHand);
        const ampedMatch = ampedIndex.size ? findAmpedForProper(ampedIndex, row) : null;

        // Read AMPED values if present, otherwise 0
        const ampedStock = ampedMatch
          ? getNumericValue(
              ampedMatch.QAV ||
                ampedMatch.qav ||
                ampedMatch.Quantity ||
                ampedMatch.Qty ||
                ampedMatch["Total Quantity"] ||
                ampedMatch["On Hand"] ||
                ampedMatch["Available Qty"] ||
                ampedMatch["Inventory Qty Available"] ||
                ampedMatch["Inv Avail"] ||
                0
            )
          : 0;

        // AMPED: sum of Wk1–Wk8 (Wk5 may have a trailing space in some exports)
        const ampedWk8Total = ampedMatch
          ? (() => {
              const m = ampedMatch;
              const wk5 = getNumericValue(m["Wk5"] || m["Wk5 "] || 0);
              return (
                getNumericValue(m["Wk1"] || 0) +
                getNumericValue(m["Wk2"] || 0) +
                getNumericValue(m["Wk3"] || 0) +
                getNumericValue(m["Wk4"] || 0) +
                wk5 +
                getNumericValue(m["Wk6"] || 0) +
                getNumericValue(m["Wk7"] || 0) +
                getNumericValue(m["Wk8"] || 0)
              );
            })()
          : 0;

        const ampedAvgWeek = ampedMatch
          ? getNumericValue(ampedMatch["Avg/Week"] || ampedMatch.AvgWeek || ampedMatch["Weekly Avg"] || 0)
          : 0;

        // Hide only if BOTH distributors have zero stock
        if (stockOnHand === 0 && ampedStock === 0) continue;

        // Proper: 3-month average monthly sales
        const salesLastMonth   = getNumericValue(row.Sales_LastMonth);
        const sales2MonthsAgo  = getNumericValue(row.Sales_2MonthsAgo);
        const sales3MonthsAgo  = getNumericValue(row.Sales_3MonthsAgo);
        const properAvgMonthly = Math.round(((salesLastMonth + sales2MonthsAgo + sales3MonthsAgo) / 3) * 100) / 100;

        // AMPED: convert Avg/Week → monthly (× 4.333 weeks/month)
        const ampedAvgMonthly = Math.round(ampedAvgWeek * 4.333 * 100) / 100;

        // Months to sell out per distributor
        const properMonths = properAvgMonthly > 0
          ? Math.round((stockOnHand / properAvgMonthly) * 10) / 10
          : null;
        const ampedMonths = ampedAvgMonthly > 0
          ? Math.round((ampedStock / ampedAvgMonthly) * 10) / 10
          : null;

        consolidated.push({
          Barcode: row.barcode_apostrophe || row.Barcode || row.UPC || "",
          "Catalog No": row.CatNo || "",
          Artist: row.Artist || "",
          Title: row.Title || "",
          "Release Date": row.ReleaseDate || "",
          Format: row.FormatCode || "",
          "Pr. Avg Sales (3M)": properAvgMonthly,
          "AMPED 8-Week Sales": ampedWk8Total,
          "AMPED Avg/Week": ampedAvgWeek,
          "Proper Stock": stockOnHand,
          "AMPED Stock": ampedStock,
          "Proper Stock Difference": stockOnHand - ampedStock,
          "Proper Months to Sell Out": properMonths !== null ? properMonths : "N/A",
          "AMPED Months to Sell Out": ampedMonths !== null ? ampedMonths : "N/A",
        });
      }

      consolidated.sort((a, b) => (b["Proper Stock Difference"] || 0) - (a["Proper Stock Difference"] || 0));
      setResult({
        data: consolidated,
        count: consolidated.length,
        filteredOut: source1Data.length - consolidated.length,
      });
    } catch (err) {
      setError(`Error processing data: ${(err as Error).message || String(err)}`);
    } finally {
      setProcessing(false);
    }
  };

  // ------------------ DOWNLOAD ------------------
  const downloadExcel = () => {
    if (!result || !result.data?.length) return;
    const ws = XLSX.utils.json_to_sheet(result.data);
    ws["!cols"] = Object.keys(result.data[0] || {}).map(() => ({ wch: 22 })); // wider columns in export
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory Finance Report");
    XLSX.writeFile(wb, `Inventory_Finance_Report_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const previewData = useMemo(() => {
    if (!result?.data?.length) return [];
    const q = query.trim().toLowerCase();
    return result.data.filter((row: any) =>
      !q ? true : Object.values(row).join(" ").toLowerCase().includes(q)
    );
  }, [result, query]);

  // ---- Derived table state (TS-safe) ----
  const hasResult = Boolean(result?.data && result.data.length > 0);
  const baseRow = hasResult ? (result as { data: any[] }).data[0] : null;
  const columns: string[] = baseRow ? Object.keys(baseRow) : [];
  const rows: any[] = hasResult ? previewData : [];
  const generatedCount = result?.count ?? 0;

  // ------------------ RENDER ------------------
  return (
    <div className={`${theme === "dark" ? "dark" : ""} relative min-h-screen overflow-hidden`}>
      {/* background */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-red-950 via-red-800 to-rose-700" />

      <div className="relative min-h-screen p-8">
        <div className="max-w-7xl mx-auto">
          <motion.header
            initial={{ y: -12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="flex items-center justify-between gap-6 mb-8"
          >
            <div>
              {/* White, thin, compact header & subheader */}
              <h1 className="text-4xl font-thin tracking-tight leading-tight text-white">
                Reservoir — Inventory Finance Report
              </h1>
              <p className="text-sm font-light text-white/80 mt-1 leading-snug">
                Consolidate Proper &amp; AMPED stock into a unified sell-through analysis.
              </p>
            </div>
          </motion.header>

          <motion.main
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white rounded-2xl shadow-xl p-6 border border-slate-100"
          >
            {/* FILE UPLOAD SECTIONS */}
            <section className="grid md:grid-cols-2 gap-6">
              {/* Proper File */}
              <motion.div
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 1 }}
                transition={{ duration: 0.15 }}
                className={`rounded-xl p-5 border-2 border-dashed cursor-pointer transition-colors ${
                  source1Data.length ? "border-red-400" : "border-slate-200"
                } ${dragOverTarget === 1 ? "ring-4 ring-red-200" : ""} hover:border-slate-400`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverTarget(1);
                }}
                onDragLeave={() => setDragOverTarget(null)}
                onDrop={(e) => handleDrop(e, 1)}
              >
                <label htmlFor="file1" className="flex items-center gap-4 cursor-pointer">
                  <div className="relative p-3 rounded-md bg-white shadow-sm">
                    <Upload
                      className={`w-7 h-7 ${
                        source1Data.length ? "text-red-600" : "text-slate-400"
                      }`}
                    />
                    <AnimatePresence>
                      {source1Data.length > 0 && (
                        <motion.div
                          initial={{ scale: 0.6, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.6, opacity: 0 }}
                          transition={{ type: "spring", stiffness: 400, damping: 18 }}
                          className="absolute -top-1 -right-1 bg-white rounded-full p-1 shadow"
                        >
                          <CheckCircle className="w-4 h-4 text-red-600" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="flex-1">
                    <div className="font-semibold">Proper — CSV</div>
                    <div className="text-xs text-slate-500">
                      Rows: {source1Data.length} • Accepts .csv
                    </div>

                    {/* Proper report date + warnings */}
                    <div className="text-xs text-slate-600 mt-2">
                      {source1Data.length && properFileName ? (
                        (() => {
                          const isProper = properFileName?.includes("Basil-SupplierStockReport") ?? false;
                          const match = properFileName?.match(/(\d{8})/) ?? null;

                          let warnings: string[] = [];
                          if (!isProper) warnings.push("WARNING: The uploaded file may not be a Proper stock report.");

                          let formatted = null as string | null;
                          if (match) {
                            const rawDate = match[1];
                            const year = rawDate.slice(0, 4);
                            const month = rawDate.slice(4, 6);
                            const day = rawDate.slice(6, 8);
                            formatted = `${day}/${month}/${year}`;

                            const fileDate = new Date(`${year}-${month}-${day}T00:00:00`);
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            if (fileDate < today) {
                              warnings.push("WARNING: The uploaded stock report is from a date prior to today.");
                            }
                          }

                          return (
                            <div className="flex flex-col">
                              <span>
                                Uploaded — {formatted ? `${formatted} Proper Report` : "Proper Report"}
                              </span>
                              {warnings.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {warnings.map((msg, i) => (
                                    <span key={i} className="block text-[11px] text-red-600">
                                      {msg}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()
                      ) : (
                        <span>Drop file or click to browse</span>
                      )}
                    </div>
                  </div>

                  <input
                    ref={fileRef1}
                    id="file1"
                    type="file"
                    accept=".csv"
                    onChange={(e) => handleFile(e.target.files?.[0], 1)}
                    className="hidden"
                  />
                </label>
              </motion.div>

              {/* AMPED File */}
              <motion.div
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 1 }}
                transition={{ duration: 0.15 }}
                className={`rounded-xl p-5 border-2 border-dashed cursor-pointer transition-colors ${
                  source2Data.length ? "border-red-400" : "border-slate-200"
                } ${dragOverTarget === 2 ? "ring-4 ring-red-200" : ""} hover:border-slate-400`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverTarget(2);
                }}
                onDragLeave={() => setDragOverTarget(null)}
                onDrop={(e) => handleDrop(e, 2)}
              >
                <label htmlFor="file2" className="flex items-center gap-4 cursor-pointer">
                  <div className="relative p-3 rounded-md bg-white shadow-sm">
                    <Upload
                      className={`w-7 h-7 ${
                        source2Data.length ? "text-red-600" : "text-slate-400"
                      }`}
                    />
                    <AnimatePresence>
                      {source2Data.length > 0 && (
                        <motion.div
                          initial={{ scale: 0.6, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.6, opacity: 0 }}
                          transition={{ type: "spring", stiffness: 400, damping: 18 }}
                          className="absolute -top-1 -right-1 bg-white rounded-full p-1 shadow"
                        >
                          <CheckCircle className="w-4 h-4 text-red-600" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold">AMPED — XLSX</div>
                    <div className="text-xs text-slate-500">
                      Rows: {source2Data.length} • Accepts .xlsx / .xls
                    </div>
                  </div>
                  <input
                    ref={fileRef2}
                    id="file2"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => handleFile(e.target.files?.[0], 2)}
                    className="hidden"
                  />
                </label>
              </motion.div>
            </section>

            {/* Controls */}
            <section className="mt-6 flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
              <div className="flex items-center gap-3 w-full md:w-2/3">
                <div className="relative flex-1 hidden md:block">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter preview (search export rows)"
                    className="w-full py-3 px-4 rounded-lg border border-slate-200 focus:ring-2 focus:ring-red-200"
                  />
                  <Search className="absolute right-3 top-3 w-4 h-4 text-slate-400" />
                </div>
                <div className="flex items-center gap-2">
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={processData}
                    disabled={!source1Data.length || !source2Data.length || processing}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-red-700 to-rose-600 text-white shadow-md disabled:opacity-60"
                  >
                    {processing ? (
                      <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                    <span className="text-sm">{processing ? "Processing" : "Generate Report"}</span>
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={downloadExcel}
                    disabled={!result}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white"
                  >
                    <Download className="w-4 h-4" /> <span className="text-sm">Download</span>
                  </motion.button>
                </div>
              </div>
            </section>

            {/* Errors */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-600" />
                <div className="text-sm text-red-800">{error}</div>
              </motion.div>
            )}

            {/* Preview Table (wider columns) – TS safe + frozen first two columns */}
            {hasResult && (
              <section className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-700">
                    Export Preview ({rows.length})
                  </h3>
                  <div className="text-xs text-slate-500">
                    {`Generated - ${generatedCount} rows`}
                  </div>
                </div>

                <div className="overflow-x-auto overflow-y-auto max-h-[520px] rounded-lg border border-slate-100">
                  <table className="min-w-full text-sm table-auto border-collapse">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                      <tr>
                        {columns.map((col, i) => {
                          const isFrozen1 = i === 0; // Barcode
                          const isFrozen2 = i === 1; // Catalog No
                          return (
                            <th
                              key={col}
                              className={`px-3 py-2 text-left whitespace-nowrap ${
                                isFrozen1 || isFrozen2 ? "sticky z-20 bg-slate-50 shadow-sm" : ""
                              }`}
                              style={{
                                minWidth: "14rem",
                                left: isFrozen1 ? 0 : isFrozen2 ? ("14rem" as any) : undefined,
                              }}
                            >
                              {col}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>

                    <tbody>
                      {rows.map((r: any, rowIndex: number) => (
                        <tr key={rowIndex} className={rowIndex % 2 ? "bg-slate-50" : "bg-white"}>
                          {columns.map((col, i) => {
                            const isFrozen1 = i === 0;
                            const isFrozen2 = i === 1;
                            return (
                              <td
                                key={`${rowIndex}-${col}`}
                                className={`px-3 py-2 ${
                                  isFrozen1 || isFrozen2 ? "sticky z-10 bg-white shadow-sm" : ""
                                }`}
                                style={{
                                  left: isFrozen1 ? 0 : isFrozen2 ? ("14rem" as any) : undefined,
                                  minWidth: "14rem",
                                }}
                              >
                                {(col === "Proper Months to Sell Out" || col === "AMPED Months to Sell Out") ? (
                                  (() => {
                                    const val = r[col];
                                    if (val === "N/A") return <span className="text-slate-400 italic">N/A</span>;
                                    const num = parseFloat(val);
                                    const color = num <= 3 ? "text-red-600 font-semibold" : num <= 6 ? "text-amber-600 font-medium" : "text-emerald-700";
                                    return <span className={color}>{val} mo</span>;
                                  })()
                                ) : (
                                  String(r[col] ?? "")
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Summary */}
            {result && (
              <motion.section
                initial={{ opacity: 0, scale: 0.96, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 360, damping: 24 }}
                className="mt-6 bg-emerald-50 p-4 rounded-lg border border-emerald-100"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-emerald-600 rounded-full">
                    <CheckCircle className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="font-semibold text-emerald-900">Report generated</div>
                    <div className="text-xs text-emerald-700">
                      Processed {result.count} releases • filtered out {result.filteredOut} items
                    </div>
                  </div>
                </div>
              </motion.section>
            )}
          </motion.main>
        </div>
      </div>
    </div>
  );
}