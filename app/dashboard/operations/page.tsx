'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Upload, FileSpreadsheet, X, CheckCircle, Loader2, AlertCircle,
  UserPlus, Download, AlertTriangle, CheckCircle2, Gauge,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import {
  parseCSV, validateRowDetailed, buildResultCSV,
  type LeadCSVRow, type RowValidationResult, type ValidationMaps,
} from '@/lib/csv-parser';
import { formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/lib/usePermissions';
import { cn } from '@/lib/utils';
import { SearchableSelect, type SearchableSelectOption } from '@/components/shared/searchable-select';

// ─── Single-lead form schema ──────────────────────────────────────────────────

const singleLeadSchema = z.object({
  name:       z.string().min(1, 'Name is required'),
  email:      z.string().email('Invalid email'),
  phone:      z.string().min(1, 'Phone is required'),
  college:    z.string().min(1, 'College is required'),
  city:       z.string().optional(),
  state:      z.string().optional(),
  course:     z.string().optional(),
  campaign:   z.string().optional(),
  leadType:   z.string().optional(),
  leadOrigin: z.string().optional(),
  leadZone:   z.string().optional(),
});
type SingleLeadForm = z.infer<typeof singleLeadSchema>;

// ─── Types ────────────────────────────────────────────────────────────────────

interface UploadBatch {
  id: string;
  fileName: string;
  totalRecords: number;
  insertedRecords: number;
  duplicateRecords: number;
  errorRecords: number;
  status: string;
  createdAt: string;
  uploadedBy: { name: string };
  _count: { leads: number };
}

interface UploadApiResult {
  batchId: string;
  fileName: string;
  inserted: number;
  duplicates: string[];
  total: number;
  invalidLeads: { row: number; email: string; errors: string[] }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function triggerDownload(content: string, filename: string, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OperationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { can } = usePermissions();
  const canUpload = can('UPLOAD_LEADS');

  // File state
  const [isDragging, setIsDragging] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [validationResults, setValidationResults] = useState<RowValidationResult[]>([]);
  const [uploadResult, setUploadResult] = useState<UploadApiResult | null>(null);
  const [allRows, setAllRows] = useState<LeadCSVRow[]>([]);

  // Single-lead dialog
  const [singleLeadOpen, setSingleLeadOpen] = useState(false);

  // History pagination
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_PAGE_SIZE = 25;

  const {
    register: regSingle, handleSubmit: handleSingleSubmit,
    reset: resetSingle, formState: { errors: singleErrors },
    setValue: setSingleValue, watch: watchSingle,
  } = useForm<SingleLeadForm>({ resolver: zodResolver(singleLeadSchema) });

  // ── Validation data ───────────────────────────────────────────────────────────
  // College IDs come from local dropdown options (fast, always available).
  // City/state/course come from external LMS API — optional; if unavailable we skip those validations.

  const { data: kappCollegesRaw } = useQuery<{ id: string; value: string; kappCollegeId: string | null }[]>({
    queryKey: ['dropdown-colleges'],
    queryFn: () => fetch('/api/dropdown-options?type=COLLEGE').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });
  const { data: citiesRaw } = useQuery({
    queryKey: ['locations-city'],
    queryFn: () => fetch('/api/locations?type=city').then((r) => r.json()).catch(() => null),
    staleTime: Infinity,
  });
  const { data: statesRaw } = useQuery({
    queryKey: ['locations-state'],
    queryFn: () => fetch('/api/locations?type=state').then((r) => r.json()).catch(() => null),
    staleTime: Infinity,
  });
  const { data: coursesRaw } = useQuery<{ id: number | string; name: string }[]>({
    queryKey: ['static-courses'],
    queryFn: () => fetch('/api/courses').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []).catch(() => []),
    staleTime: Infinity,
  });

  // Lead Type / Lead Origin / Zone come from Manage Dropdowns (Super Admin's
  // own configured lists), same source the Single Add Lead form's dropdowns
  // draw from — not free text, so agents can't introduce typo variants.
  const { data: leadTypesRaw } = useQuery<{ id: string; value: string }[]>({
    queryKey: ['dropdown-lead-types'],
    queryFn: () => fetch('/api/dropdown-options?type=LEAD_TYPE').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });
  const { data: leadOriginsRaw } = useQuery<{ id: string; value: string }[]>({
    queryKey: ['dropdown-lead-origins'],
    queryFn: () => fetch('/api/dropdown-options?type=LEAD_ORIGIN').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });
  const { data: leadZonesRaw } = useQuery<{ id: string; value: string }[]>({
    queryKey: ['dropdown-zones'],
    queryFn: () => fetch('/api/dropdown-options?type=ZONE').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });

  // Single Add Lead dropdown options — the Lead model stores these as plain
  // strings (no foreign keys), so each option's value IS the display name,
  // matching exactly what CSV upload and the rest of the app already store.
  const cityOptions = useMemo<SearchableSelectOption[]>(
    () => ((citiesRaw?.data ?? []) as { city_name: string }[]).map((c) => ({ value: c.city_name, label: c.city_name })),
    [citiesRaw],
  );
  const stateOptions = useMemo<SearchableSelectOption[]>(
    () => ((statesRaw?.data ?? []) as { name: string }[]).map((s) => ({ value: s.name, label: s.name })),
    [statesRaw],
  );
  const courseOptions = useMemo<SearchableSelectOption[]>(
    () => (coursesRaw ?? []).map((c) => ({ value: c.name, label: c.name })),
    [coursesRaw],
  );
  const collegeOptions = useMemo<SearchableSelectOption[]>(
    () => (kappCollegesRaw ?? []).map((c) => ({ value: c.value, label: c.value })),
    [kappCollegesRaw],
  );
  const leadTypeOptions = useMemo<SearchableSelectOption[]>(
    () => (leadTypesRaw ?? []).map((o) => ({ value: o.value, label: o.value })),
    [leadTypesRaw],
  );
  const leadOriginOptions = useMemo<SearchableSelectOption[]>(
    () => (leadOriginsRaw ?? []).map((o) => ({ value: o.value, label: o.value })),
    [leadOriginsRaw],
  );
  const leadZoneOptions = useMemo<SearchableSelectOption[]>(
    () => (leadZonesRaw ?? []).map((o) => ({ value: o.value, label: o.value })),
    [leadZonesRaw],
  );

  // Build lookup maps — only block on kappCollegesRaw (local DB); city/state/course are optional
  const validationMaps = useMemo<ValidationMaps | undefined>(() => {
    if (!kappCollegesRaw) return undefined; // wait only for local DB data

    const kappCollegeIdMap = new Map<string, string>();
    kappCollegesRaw.forEach((c) => {
      if (c.kappCollegeId) kappCollegeIdMap.set(c.kappCollegeId.toLowerCase(), c.value);
    });

    const cityMap = new Map<string, string>();
    const cityList: { city_name: string }[] = citiesRaw?.data ?? [];
    cityList.forEach((c) => { if (c.city_name) cityMap.set(c.city_name.toLowerCase(), c.city_name); });

    const stateMap = new Map<string, string>();
    const stateList: { name: string }[] = statesRaw?.data ?? [];
    stateList.forEach((s) => { if (s.name) stateMap.set(s.name.toLowerCase(), s.name); });

    const courseMap = new Map<string, string>();
    (coursesRaw ?? []).forEach((c) => { if (c.name) courseMap.set(c.name.toLowerCase(), c.name); });

    return { cityMap, stateMap, courseMap, kappCollegeIdMap };
  }, [kappCollegesRaw, citiesRaw, statesRaw, coursesRaw]);

  const mapsLoading = !validationMaps;

  // ── Derived validation stats ──────────────────────────────────────────────────

  const validRows    = useMemo(() => validationResults.filter((r) => r.errors.length === 0), [validationResults]);
  const invalidRows  = useMemo(() => validationResults.filter((r) => r.errors.length > 0),  [validationResults]);

  // ── Per-upload batch limit ────────────────────────────────────────────────────

  const { data: limitInfo } = useQuery<{ uploadLimit: number | null }>({
    queryKey: ['upload-limit-me'],
    queryFn: () => fetch('/api/upload-limits/me').then((r) => r.json()),
    staleTime: 60_000,
  });

  // ── Batch history ─────────────────────────────────────────────────────────────

  const { data: batches = [], isLoading: batchesLoading } = useQuery<UploadBatch[]>({
    queryKey: ['upload-batches'],
    queryFn: () => fetch('/api/upload').then((r) => r.json()),
  });

  // ── Upload mutation ───────────────────────────────────────────────────────────

  const uploadMutation = useMutation({
    mutationFn: (data: { fileName: string; leads: LeadCSVRow[]; errorRecords: number }) =>
      fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: (data: UploadApiResult) => {
      if ('error' in data) {
        toast({ variant: 'destructive', title: 'Upload failed', description: JSON.stringify((data as { error: unknown }).error) });
        return;
      }
      setUploadResult(data);
      queryClient.invalidateQueries({ queryKey: ['upload-batches'] });
    },
  });

  // ── Single-lead mutation ──────────────────────────────────────────────────────

  const singleLeadMutation = useMutation({
    mutationFn: (data: SingleLeadForm) =>
      fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      if (data.error) {
        toast({ variant: 'destructive', title: 'Failed to add lead', description: typeof data.error === 'string' ? data.error : 'Validation error' });
        return;
      }
      toast({ title: 'Lead added', description: `${data.name} has been added successfully.` });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setSingleLeadOpen(false);
      resetSingle();
    },
  });

  // ── File handling ─────────────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast({ variant: 'destructive', title: 'Invalid file', description: 'Please upload a CSV file' });
      return;
    }
    setCsvFile(file);
    setParseError(null);
    setValidationResults([]);
    setUploadResult(null);

    try {
      const rows = await parseCSV(file);
      setAllRows(rows);
      const results = rows.map((row, i) =>
        validateRowDetailed(row, i + 2, validationMaps)
      );
      setValidationResults(results);
    } catch (err) {
      setParseError(String(err));
    }
  }, [toast, validationMaps]);

  // Re-run validation when maps load (handles case where file was dropped before maps finished loading)
  const prevMapsRef = useRef(validationMaps);
  if (csvFile && allRows.length > 0 && validationMaps && prevMapsRef.current !== validationMaps) {
    prevMapsRef.current = validationMaps;
    const results = allRows.map((row, i) => validateRowDetailed(row, i + 2, validationMaps));
    setValidationResults(results);
  }

  const clearFile = () => {
    setCsvFile(null);
    setParseError(null);
    setValidationResults([]);
    setUploadResult(null);
    setAllRows([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  // Upload only valid rows
  const handleUpload = () => {
    if (!csvFile || validRows.length === 0) return;
    uploadMutation.mutate({
      fileName: csvFile.name,
      leads: validRows.map((r) => r.normalized),
      errorRecords: invalidRows.length,
    });
  };

  // ── CSV downloads ─────────────────────────────────────────────────────────────

  const downloadSampleCSV = () => {
    const headers = ['name', 'email', 'phone', 'city', 'state', 'course', 'college', 'lead_code', 'lead_type', 'lead_origin', 'lead_zone', 'lead_confirmation', 'lead_stage', 'lead_verification', 'data_calling_type', 'created_at'];
    const sample  = ['Rahul Sharma', 'rahul@example.com', '9876543210', 'Mumbai', 'Maharashtra', 'B.Tech', 'IIT Bombay', 'Google Ads', 'Organic', 'Website', 'West', '', '', '', '', '2026-06-09'];
    triggerDownload([headers.join(','), sample.join(',')].join('\n'), 'leads_sample.csv');
  };

  const downloadValidationReport = () => {
    triggerDownload(buildResultCSV(validationResults), `validation_report_${csvFile?.name ?? 'leads'}`);
  };

  const downloadUploadReport = () => {
    if (!uploadResult) return;
    const dupSet = new Set(uploadResult.duplicates);
    triggerDownload(buildResultCSV(validationResults, dupSet), `upload_report_${csvFile?.name ?? 'leads'}`);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Upload Card ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Upload Lead CSV</CardTitle>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={downloadSampleCSV}>
                <Download className="mr-2 h-4 w-4" /> Sample CSV
              </Button>
              {canUpload && (
                <Button variant="outline" size="sm" onClick={() => setSingleLeadOpen(true)}>
                  <UserPlus className="mr-2 h-4 w-4" /> Add Single Lead
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">

          {/* ── Per-upload limit notice ── */}
          {limitInfo && limitInfo.uploadLimit !== null && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
              <Gauge className="h-5 w-5 shrink-0 text-muted-foreground" />
              <p className="text-sm">
                <span className="font-medium">Upload limit: </span>
                <span className="text-muted-foreground">
                  Each CSV can have at most{' '}
                  <span className="font-semibold text-foreground">{limitInfo.uploadLimit.toLocaleString()} rows</span>.
                  Split larger files into smaller batches before uploading.
                </span>
              </p>
            </div>
          )}

          {!canUpload ? (
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-12 text-center">
              <AlertCircle className="mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">You don&apos;t have permission to upload leads.</p>
              <p className="text-xs text-muted-foreground mt-1">Contact your administrator to enable this feature.</p>
            </div>
          ) : (
            <>
              {/* ── Drop zone (no file yet) ── */}
              {!csvFile && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors cursor-pointer',
                    isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50',
                  )}
                >
                  <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
                  <p className="text-lg font-medium">Drop your CSV here</p>
                  <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
                  <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
                </div>
              )}

              {/* ── File selected ── */}
              {csvFile && !uploadResult && (
                <div className="space-y-4">

                  {/* File info bar */}
                  <div className="flex items-center justify-between rounded-lg border p-3.5">
                    <div className="flex items-center gap-3">
                      <FileSpreadsheet className="h-8 w-8 text-emerald-600 shrink-0" />
                      <div>
                        <p className="font-medium text-sm">{csvFile.name}</p>
                        <p className="text-xs text-muted-foreground">{allRows.length} rows parsed</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={clearFile}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* CSV parse error */}
                  {parseError && (
                    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <p className="text-sm text-destructive">{parseError}</p>
                    </div>
                  )}

                  {/* Validation maps still loading */}
                  {!parseError && mapsLoading && (
                    <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      Loading validation data (cities, states, courses, colleges)…
                    </div>
                  )}

                  {/* ── Validation summary ── */}
                  {!parseError && !mapsLoading && validationResults.length > 0 && (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border p-3 text-center">
                          <p className="text-xl font-bold">{allRows.length}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Total rows</p>
                        </div>
                        <div className={cn('rounded-lg border p-3 text-center', validRows.length > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-muted')}>
                          <p className="text-xl font-bold text-emerald-700">{validRows.length}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Ready to upload</p>
                        </div>
                        <div className={cn('rounded-lg border p-3 text-center', invalidRows.length > 0 ? 'border-red-200 bg-red-50' : 'border-muted')}>
                          <p className="text-xl font-bold text-red-600">{invalidRows.length}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Have errors</p>
                        </div>
                      </div>

                      {/* Validation table */}
                      <div className="rounded-lg border overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Validation Results</p>
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={downloadValidationReport}>
                            <Download className="h-3 w-3" /> Download Report
                          </Button>
                        </div>
                        <div className="overflow-x-auto max-h-72 overflow-y-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-14">Row</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Phone</TableHead>
                                <TableHead className="w-24">Status</TableHead>
                                <TableHead>Issues</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {validationResults.map((r) => (
                                <TableRow
                                  key={r.rowNumber}
                                  className={r.errors.length > 0 ? 'bg-red-50/40' : 'bg-emerald-50/30'}
                                >
                                  <TableCell className="text-xs text-muted-foreground font-mono">{r.rowNumber}</TableCell>
                                  <TableCell className="text-sm font-medium max-w-[140px] truncate">{r.raw.name || <span className="text-muted-foreground italic">empty</span>}</TableCell>
                                  <TableCell className="text-xs max-w-[160px] truncate text-muted-foreground">{r.raw.email || '—'}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{r.raw.phone || '—'}</TableCell>
                                  <TableCell>
                                    {r.errors.length === 0
                                      ? <Badge variant="success" className="text-[10px]">Valid</Badge>
                                      : <Badge variant="destructive" className="text-[10px]">Failed</Badge>}
                                  </TableCell>
                                  <TableCell className="text-xs text-red-600 max-w-[280px]">
                                    {r.errors.length > 0
                                      ? <ul className="space-y-0.5">{r.errors.map((e, i) => <li key={i}>• {e}</li>)}</ul>
                                      : <span className="text-emerald-600">All checks passed</span>}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-xs text-muted-foreground">
                          {invalidRows.length > 0 && `${invalidRows.length} row${invalidRows.length !== 1 ? 's' : ''} will be skipped. `}
                          {validRows.length > 0
                            ? `${validRows.length} row${validRows.length !== 1 ? 's' : ''} will be uploaded.`
                            : 'No valid rows to upload.'}
                        </p>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={clearFile}>Cancel</Button>
                          <Button
                            onClick={handleUpload}
                            disabled={uploadMutation.isPending || validRows.length === 0}
                          >
                            {uploadMutation.isPending
                              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              : <CheckCircle className="mr-2 h-4 w-4" />}
                            Upload {validRows.length} Valid Lead{validRows.length !== 1 ? 's' : ''}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Upload result ── */}
              {uploadResult && (
                <div className="space-y-4">
                  {/* Summary card */}
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                      <p className="font-semibold text-emerald-800">Upload Complete</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <ResultStat label="Total Sent" value={uploadResult.total} color="slate" />
                      <ResultStat label="Successfully Inserted" value={uploadResult.inserted} color="emerald" />
                      <ResultStat label="Duplicates Skipped" value={uploadResult.duplicates.length} color={uploadResult.duplicates.length > 0 ? 'amber' : 'slate'} />
                    </div>
                    {invalidRows.length > 0 && (
                      <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        {invalidRows.length} row{invalidRows.length !== 1 ? 's' : ''} with format errors were not uploaded. Download the report to fix and re-upload.
                      </div>
                    )}
                    {(uploadResult.invalidLeads?.length ?? 0) > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span>
                            <strong>{uploadResult.invalidLeads.length} row{uploadResult.invalidLeads.length !== 1 ? 's' : ''} rejected</strong> — dropdown values don&apos;t match allowed options:
                          </span>
                        </div>
                        <div className="max-h-48 overflow-y-auto rounded-md border border-red-200 bg-white text-xs divide-y divide-red-100">
                          {uploadResult.invalidLeads.map((inv) => (
                            <div key={`${inv.row}-${inv.email}`} className="px-3 py-2">
                              <p className="font-medium text-red-700">Row {inv.row} — {inv.email}</p>
                              <ul className="mt-0.5 space-y-0.5 text-red-600">
                                {inv.errors.map((e, i) => <li key={i}>• {e}</li>)}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Download report + reset */}
                  <div className="flex items-center justify-between gap-3">
                    <Button variant="outline" onClick={downloadUploadReport} className="gap-2">
                      <Download className="h-4 w-4" /> Download Upload Report
                    </Button>
                    <Button onClick={clearFile}>Upload Another File</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Single Lead Dialog ── */}
      <Dialog open={singleLeadOpen} onOpenChange={(v) => { if (!v) { setSingleLeadOpen(false); resetSingle(); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Single Lead</DialogTitle></DialogHeader>
          <form onSubmit={handleSingleSubmit((data) => singleLeadMutation.mutate(data))} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input {...regSingle('name')} placeholder="Full name" />
                {singleErrors.name && <p className="text-xs text-destructive">{singleErrors.name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Email <span className="text-destructive">*</span></Label>
                <Input {...regSingle('email')} type="email" placeholder="email@example.com" />
                {singleErrors.email && <p className="text-xs text-destructive">{singleErrors.email.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Phone <span className="text-destructive">*</span></Label>
                <Input {...regSingle('phone')} placeholder="10-digit phone" />
                {singleErrors.phone && <p className="text-xs text-destructive">{singleErrors.phone.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Lead Code</Label>
                <Input {...regSingle('campaign')} placeholder="e.g. Google Ads" />
              </div>
              <div className="space-y-1.5">
                <Label>City</Label>
                <SearchableSelect
                  options={cityOptions}
                  value={watchSingle('city') ?? ''}
                  onChange={(v) => setSingleValue('city', v, { shouldValidate: true })}
                  placeholder="— Select City —"
                />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <SearchableSelect
                  options={stateOptions}
                  value={watchSingle('state') ?? ''}
                  onChange={(v) => setSingleValue('state', v, { shouldValidate: true })}
                  placeholder="— Select State —"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Course</Label>
                <SearchableSelect
                  options={courseOptions}
                  value={watchSingle('course') ?? ''}
                  onChange={(v) => setSingleValue('course', v, { shouldValidate: true })}
                  placeholder="— Select Course —"
                />
              </div>
              <div className="space-y-1.5">
                <Label>College <span className="text-destructive">*</span></Label>
                <SearchableSelect
                  options={collegeOptions}
                  value={watchSingle('college') ?? ''}
                  onChange={(v) => setSingleValue('college', v, { shouldValidate: true })}
                  placeholder="— Select College —"
                />
                {singleErrors.college && <p className="text-xs text-destructive">{singleErrors.college.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Lead Type</Label>
                <SearchableSelect
                  options={leadTypeOptions}
                  value={watchSingle('leadType') ?? ''}
                  onChange={(v) => setSingleValue('leadType', v, { shouldValidate: true })}
                  placeholder="— Select Lead Type —"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Lead Origin</Label>
                <SearchableSelect
                  options={leadOriginOptions}
                  value={watchSingle('leadOrigin') ?? ''}
                  onChange={(v) => setSingleValue('leadOrigin', v, { shouldValidate: true })}
                  placeholder="— Select Lead Origin —"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Lead Zone</Label>
                <SearchableSelect
                  options={leadZoneOptions}
                  value={watchSingle('leadZone') ?? ''}
                  onChange={(v) => setSingleValue('leadZone', v, { shouldValidate: true })}
                  placeholder="— Select Lead Zone —"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setSingleLeadOpen(false); resetSingle(); }}>Cancel</Button>
              <Button type="submit" disabled={singleLeadMutation.isPending}>
                {singleLeadMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Lead
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Upload History ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Upload History</CardTitle>
              {!batchesLoading && batches.length > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {batches.length} total upload{batches.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {batchesLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="pl-4 w-10">#</TableHead>
                    <TableHead>File Name</TableHead>
                    <TableHead>Uploaded By</TableHead>
                    <TableHead className="text-center">Total</TableHead>
                    <TableHead className="text-center">Inserted</TableHead>
                    <TableHead className="text-center">Duplicates</TableHead>
                    <TableHead className="text-center">Errors</TableHead>
                    <TableHead className="pr-4">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                        No uploads yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    batches
                      .slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE)
                      .map((batch, idx) => (
                        <TableRow key={batch.id}>
                          <TableCell className="pl-4 text-xs text-muted-foreground font-mono">
                            {(historyPage - 1) * HISTORY_PAGE_SIZE + idx + 1}
                          </TableCell>
                          <TableCell className="font-medium max-w-[220px] truncate" title={batch.fileName}>
                            {batch.fileName}
                          </TableCell>
                          <TableCell className="text-sm">{batch.uploadedBy.name}</TableCell>
                          <TableCell className="text-center">
                            <span className="text-sm font-medium">{batch.totalRecords}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={cn(
                              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                              batch.insertedRecords > 0
                                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                : 'text-muted-foreground',
                            )}>
                              {batch.insertedRecords}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={cn(
                              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                              batch.duplicateRecords > 0
                                ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                                : 'text-muted-foreground',
                            )}>
                              {batch.duplicateRecords}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={cn(
                              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                              batch.errorRecords > 0
                                ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
                                : 'text-muted-foreground',
                            )}>
                              {batch.errorRecords}
                            </span>
                          </TableCell>
                          <TableCell className="pr-4 text-xs text-muted-foreground">
                            {formatDateTime(batch.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>

              {/* Pagination */}
              {batches.length > HISTORY_PAGE_SIZE && (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    Showing {(historyPage - 1) * HISTORY_PAGE_SIZE + 1}–{Math.min(historyPage * HISTORY_PAGE_SIZE, batches.length)} of {batches.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      disabled={historyPage === 1}
                    >
                      Previous
                    </Button>
                    {/* Page number pills */}
                    {Array.from({ length: Math.ceil(batches.length / HISTORY_PAGE_SIZE) }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === Math.ceil(batches.length / HISTORY_PAGE_SIZE) || Math.abs(p - historyPage) <= 1)
                      .reduce<(number | '…')[]>((acc, p, i, arr) => {
                        if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('…');
                        acc.push(p);
                        return acc;
                      }, [])
                      .map((p, i) =>
                        p === '…' ? (
                          <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                        ) : (
                          <button
                            key={p}
                            onClick={() => setHistoryPage(p as number)}
                            className={cn(
                              'h-7 min-w-[28px] rounded-md px-2 text-xs font-medium transition-colors',
                              historyPage === p
                                ? 'bg-primary text-primary-foreground'
                                : 'border border-input text-muted-foreground hover:bg-muted/50',
                            )}
                          >
                            {p}
                          </button>
                        )
                      )}
                    <Button
                      variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => setHistoryPage((p) => Math.min(Math.ceil(batches.length / HISTORY_PAGE_SIZE), p + 1))}
                      disabled={historyPage === Math.ceil(batches.length / HISTORY_PAGE_SIZE)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helper component ─────────────────────────────────────────────────────────

function ResultStat({ label, value, color }: { label: string; value: number; color: 'emerald' | 'amber' | 'slate' }) {
  const styles = {
    emerald: 'bg-white border-emerald-200 text-emerald-700',
    amber:   'bg-white border-amber-200   text-amber-700',
    slate:   'bg-white border-slate-200   text-slate-700',
  };
  return (
    <div className={cn('rounded-lg border p-3 text-center', styles[color])}>
      <p className="text-2xl font-bold leading-none">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1 font-medium">{label}</p>
    </div>
  );
}
