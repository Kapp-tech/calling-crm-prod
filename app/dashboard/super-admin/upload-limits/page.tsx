'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, FileSpreadsheet, Check, Infinity, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

interface LimitData {
  uploadLimit: number | null;
}

export default function UploadLimitsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [inputValue, setInputValue] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const { data, isLoading } = useQuery<LimitData>({
    queryKey: ['upload-limit-global'],
    queryFn: () => fetch('/api/upload-limits').then((r) => r.json()),
  });

  useEffect(() => {
    if (data !== undefined && !isDirty) {
      setInputValue(data.uploadLimit !== null ? String(data.uploadLimit) : '');
    }
  }, [data, isDirty]);

  const saveMutation = useMutation({
    mutationFn: (uploadLimit: number | null) =>
      fetch('/api/upload-limits', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadLimit }),
      }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) {
        toast({ variant: 'destructive', title: 'Error', description: res.error });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['upload-limit-global'] });
      queryClient.invalidateQueries({ queryKey: ['upload-limit-me'] });
      setIsDirty(false);
      toast({
        title: 'Upload limit saved',
        description: res.uploadLimit
          ? `Each CSV upload is now limited to ${res.uploadLimit.toLocaleString()} rows.`
          : 'Limit removed — any size CSV can be uploaded.',
      });
    },
  });

  const handleSave = () => {
    const trimmed = inputValue.trim();
    if (trimmed === '') {
      saveMutation.mutate(null);
      return;
    }
    const num = parseInt(trimmed, 10);
    if (isNaN(num) || num < 1) {
      toast({ variant: 'destructive', title: 'Invalid value', description: 'Enter a positive number, or leave blank to remove the limit.' });
      return;
    }
    saveMutation.mutate(num);
  };

  const currentLimit = data?.uploadLimit ?? null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload Limits</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set the maximum number of rows allowed per CSV upload. Users can upload as many times as they want — only the size of each file is restricted.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Max Rows Per CSV Upload
          </CardTitle>
          <CardDescription>
            Any CSV with more rows than this limit will be rejected. Leave blank to allow any file size.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading current setting…
            </div>
          ) : (
            <>
              {/* Current status */}
              <div className="rounded-lg border bg-muted/40 px-4 py-3 flex items-center gap-3">
                {currentLimit !== null ? (
                  <>
                    <FileSpreadsheet className="h-5 w-5 text-primary shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">
                        Current limit: {currentLimit.toLocaleString()} rows per upload
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Any CSV exceeding {currentLimit.toLocaleString()} rows will be rejected at upload time.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Infinity className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-muted-foreground">No limit set — any file size accepted</p>
                      <p className="text-xs text-muted-foreground">
                        The server hard cap is 5,000 rows per upload regardless of this setting.
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Edit field */}
              <div className="space-y-2">
                <Label htmlFor="limit-input">Max rows per CSV (leave blank for no limit)</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="limit-input"
                    type="number"
                    min={1}
                    max={5000}
                    placeholder="e.g. 1000"
                    value={inputValue}
                    onChange={(e) => { setInputValue(e.target.value); setIsDirty(true); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                    className="max-w-xs"
                  />
                  <Button onClick={handleSave} disabled={saveMutation.isPending || !isDirty}>
                    {saveMutation.isPending
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Check className="mr-2 h-4 w-4" />}
                    Save
                  </Button>
                  {isDirty && (
                    <Button
                      variant="ghost"
                      onClick={() => { setInputValue(currentLimit !== null ? String(currentLimit) : ''); setIsDirty(false); }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Maximum allowed value is 5,000 (server hard cap). Applies to all users equally.
                </p>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  This applies to all roles including Super Admin. If a CSV exceeds the limit it will be rejected — the user must split the file into smaller batches.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
