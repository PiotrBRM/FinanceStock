import { useState } from 'react';
import { Upload, Download, AlertCircle, CheckCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

// ============ EXCLUSION LISTS - EDIT HERE ============
const EXCLUDED_LABELS = [
  'INTERSCOPE',
  'COLUMBIA',
  'ATLANTIC',
  'CAPITOL',
  'RCA',
  'REPUBLIC',
  'EPIC',
  'DEF JAM',
  'UNIVERSAL',
  'WARNER',
];

const EXCLUDED_ARTISTS = [
  'DE LA SOUL',
];
// ======================================================

interface DataRow {
  [key: string]: any;
}

interface ConsolidatedRow {
  'Barcode': string;
  'Catalog No': string;
  'Artist': string;
  'Title': string;
  'Release Date': string;
  'Format': string;
  'Sales Last Month': number;
  'Sales 2 Months Ago': number;
  'Sales 3 Months Ago': number;
  'Avg Sales (3M)': number;
  'Proper Stock': number;
  'AMPED Stock': number;
  'Stock Difference': number;
}

interface ProcessResult {
  data: ConsolidatedRow[];
  count: number;
  filteredOut: number;
}

const StockConsolidator = () => {
  const [source1Data, setSource1Data] = useState<DataRow[]>([]);
  const [source2Data, setSource2Data] = useState<DataRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readCSVFile = (file: File): Promise<DataRow[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        Papa.parse(text, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => resolve(results.data as DataRow[]),
          error: (error: Error) => reject(error)
        });
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const readExcelFile = (file: File): Promise<DataRow[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: '' });
          resolve(jsonData as DataRow[]);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, source: number) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    
    try {
      let data: DataRow[];
      if (isExcel) {
        data = await readExcelFile(file);
      } else {
        data = await readCSVFile(file);
      }
      
      if (source === 1) {
        setSource1Data(data);
      } else {
        setSource2Data(data);
      }
    } catch (err) {
      setError(`Error loading ${file.name}: ${(err as Error).message}`);
    }
  };

  const isExcludedLabel = (labelName: any): boolean => {
    if (!labelName || typeof labelName !== 'string') return false;
    const labelUpper = labelName.toUpperCase();
    return EXCLUDED_LABELS.some(excluded => labelUpper.includes(excluded));
  };

  const isExcludedArtist = (artistName: any): boolean => {
    if (!artistName || typeof artistName !== 'string') return false;
    const artistUpper = artistName.toUpperCase();
    return EXCLUDED_ARTISTS.some(excluded => artistUpper.includes(excluded));
  };

  const getNumericValue = (value: any): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[^0-9.-]/g, '');
      return parseFloat(cleaned) || 0;
    }
    return 0;
  };

  const processData = () => {
    if (!source1Data.length || !source2Data.length) {
      setError('Please upload both source files');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const source2Map = new Map();
      source2Data.forEach(row => {
        const key = (row.barcode || row.CatNo || '').toString().trim();
        if (key) {
          source2Map.set(key, row);
        }
      });

      const consolidated: ConsolidatedRow[] = [];
      
      source1Data.forEach(row => {
        if (isExcludedLabel(row.LabelName) || isExcludedLabel(row.SubLabelName)) {
          return;
        }

        if (isExcludedArtist(row.Artist)) {
          return;
        }

        if (row.Title && typeof row.Title === 'string' && row.Title.toUpperCase().includes('DELETED')) {
          return;
        }

        const stockOnHand = getNumericValue(row.StockOnHand);
        
        if (stockOnHand > 300) {
          return;
        }

        const last3Months = [
          getNumericValue(row.Sales_LastMonth),
          getNumericValue(row.Sales_2MonthsAgo),
          getNumericValue(row.Sales_3MonthsAgo)
        ];
        const avgSales = last3Months.reduce((a, b) => a + b, 0) / 3;

        const key = (row.barcode || row.CatNo || '').toString().trim();
        const source2Match = source2Map.get(key);
        
        let ampedStock = 0;
        if (source2Match) {
          ampedStock = getNumericValue(source2Match.QAV || source2Match.qav || 
                                        source2Match['Quality Available'] || 0);
        }

        consolidated.push({
          'Barcode': row.barcode_apostrophe || row.barcode || '',
          'Catalog No': row.CatNo || '',
          'Artist': row.Artist || '',
          'Title': row.Title || '',
          'Release Date': row.ReleaseDate || '',
          'Format': row.FormatCode || '',
          'Sales Last Month': getNumericValue(row.Sales_LastMonth),
          'Sales 2 Months Ago': getNumericValue(row.Sales_2MonthsAgo),
          'Sales 3 Months Ago': getNumericValue(row.Sales_3MonthsAgo),
          'Avg Sales (3M)': Math.round(avgSales * 100) / 100,
          'Proper Stock': stockOnHand,
          'AMPED Stock': ampedStock,
          'Stock Difference': stockOnHand - ampedStock
        });
      });

      consolidated.sort((a, b) => b['Avg Sales (3M)'] - a['Avg Sales (3M)']);

      setResult({
        data: consolidated,
        count: consolidated.length,
        filteredOut: source1Data.length - consolidated.length
      });

    } catch (err) {
      setError(`Error processing data: ${(err as Error).message}`);
    } finally {
      setProcessing(false);
    }
  };

  const downloadExcel = () => {
    if (!result) return;

    const ws = XLSX.utils.json_to_sheet(result.data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Consolidated Stock');
    
    const cols: { wch: number }[] = [];
    Object.keys(result.data[0] || {}).forEach(() => {
      cols.push({ wch: 15 });
    });
    ws['!cols'] = cols;

    XLSX.writeFile(wb, `Consolidated_Stock_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">
            Music Stock Report Consolidator
          </h1>
          <p className="text-slate-600 mb-8">
            Upload your source files to generate a consolidated report with filtered data and stock comparison
          </p>

          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 hover:border-blue-400 transition-colors">
              <label className="cursor-pointer block">
                <div className="flex flex-col items-center">
                  <Upload className="w-12 h-12 text-slate-400 mb-3" />
                  <span className="text-sm font-medium text-slate-700 mb-1">
                    Proper (CSV)
                  </span>
                  <span className="text-xs text-slate-500 mb-3">
                    {source1Data.length > 0 ? `✓ Loaded (${source1Data.length} rows)` : 'Click to upload'}
                  </span>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => handleFileUpload(e, 1)}
                    className="hidden"
                  />
                </div>
              </label>
            </div>

            <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 hover:border-blue-400 transition-colors">
              <label className="cursor-pointer block">
                <div className="flex flex-col items-center">
                  <Upload className="w-12 h-12 text-slate-400 mb-3" />
                  <span className="text-sm font-medium text-slate-700 mb-1">
                    AMPED (XLSX)
                  </span>
                  <span className="text-xs text-slate-500 mb-3">
                    {source2Data.length > 0 ? `✓ Loaded (${source2Data.length} rows)` : 'Click to upload'}
                  </span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => handleFileUpload(e, 2)}
                    className="hidden"
                  />
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-center mb-8">
            <button
              onClick={processData}
              disabled={!source1Data.length || !source2Data.length || processing}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold px-8 py-3 rounded-lg transition-colors flex items-center gap-2"
            >
              {processing ? 'Processing...' : 'Generate Consolidated Report'}
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <div className="text-sm text-red-800">{error}</div>
            </div>
          )}

          {result && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <div className="flex items-start gap-3 mb-4">
                <CheckCircle className="w-6 h-6 text-green-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-green-900 mb-1">
                    Report Generated Successfully
                  </h3>
                  <p className="text-sm text-green-700">
                    Processed {result.count} releases (filtered out {result.filteredOut} items)
                  </p>
                </div>
              </div>

              <div className="bg-white rounded p-4 mb-4">
                <h4 className="font-medium text-slate-700 mb-2">Filters Applied:</h4>
                <ul className="text-sm text-slate-600 space-y-1">
                  <li>✓ Excluded specified labels and artists</li>
                  <li>✓ Excluded items with &gt;300 units</li>
                  <li>✓ Excluded releases with 'DELETED' in title</li>
                  <li>✓ Calculated average sales (last 3 months)</li>
                  <li>✓ Added side-by-side stock comparison</li>
                </ul>
              </div>

              <button
                onClick={downloadExcel}
                className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors flex items-center gap-2"
              >
                <Download className="w-5 h-5" />
                Download Consolidated Report
              </button>
            </div>
          )}

          <div className="mt-8 pt-8 border-t border-slate-200">
            <h3 className="font-semibold text-slate-700 mb-3">How it works:</h3>
            <ol className="text-sm text-slate-600 space-y-2 list-decimal list-inside">
              <li>Upload Proper (CSV) and AMPED (XLSX) files</li>
              <li>Click "Generate Consolidated Report" to process the data</li>
              <li>The tool will automatically filter out pre-defined US labels, artists, items with &gt;300 stock units, and releases with 'DELETED' in the title</li>
              <li>It calculates the average of last 3 months sales</li>
              <li>Stock levels from both sources are displayed side-by-side for easy comparison</li>
              <li>Download the consolidated Excel report</li>
            </ol>
            <p className="text-xs text-slate-500 mt-4">
              <strong>Note:</strong> To modify the excluded labels or artists, edit the EXCLUDED_LABELS and EXCLUDED_ARTISTS arrays at the top of the script.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StockConsolidator;