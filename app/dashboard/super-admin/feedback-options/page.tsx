'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Loader2, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { FEEDBACK_CATEGORY_PRESETS, DEFAULT_CATEGORY_COLOR, HEX_COLOR_RE, feedbackCategoryTone, normalizeCategoryColor } from '@/lib/feedback-category-colors';

interface FeedbackCategory {
  id: string;
  name: string;
  color: string;
  _count: { feedbackOptions: number };
}

interface FeedbackOption {
  id: string;
  label: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  categoryId?: string | null;
  category?: { id: string; name: string; color: string } | null;
}

const NONE_CATEGORY = '__none__';

export default function FeedbackOptionsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: session } = useSession();

  const [showDialog, setShowDialog] = useState(false);
  const [editOption, setEditOption] = useState<FeedbackOption | null>(null);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>(NONE_CATEGORY);

  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [editCategory, setEditCategory] = useState<FeedbackCategory | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [categoryColor, setCategoryColor] = useState(DEFAULT_CATEGORY_COLOR);
  const isValidColor = HEX_COLOR_RE.test(categoryColor);

  const { data: options = [], isLoading } = useQuery<FeedbackOption[]>({
    queryKey: ['feedback-options-all'],
    queryFn: () =>
      fetch('/api/feedback-options?all=1').then(async (r) => {
        const d = await r.json();
        return Array.isArray(d) ? d : [];
      }),
    enabled: !!session?.user?.id,
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<FeedbackCategory[]>({
    queryKey: ['feedback-categories-all'],
    queryFn: () =>
      fetch('/api/feedback-categories?all=1').then(async (r) => {
        const d = await r.json();
        return Array.isArray(d) ? d : [];
      }),
    enabled: !!session?.user?.id,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['feedback-options-all'] });
    qc.invalidateQueries({ queryKey: ['feedback-options'] });
  };

  const invalidateCategories = () => {
    qc.invalidateQueries({ queryKey: ['feedback-categories-all'] });
    qc.invalidateQueries({ queryKey: ['feedback-categories'] });
    invalidateAll(); // option rows embed category info too
  };

  // ── Feedback value mutations ────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        label: label.trim(),
        description: description.trim() || undefined,
        categoryId: categoryId === NONE_CATEGORY ? null : categoryId,
      };
      const url = editOption ? `/api/feedback-options/${editOption.id}` : '/api/feedback-options';
      const r = await fetch(url, {
        method: editOption ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
    },
    onSuccess: () => {
      toast({ title: editOption ? 'Option updated' : 'Option added' });
      setShowDialog(false);
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (opt: FeedbackOption) =>
      fetch(`/api/feedback-options/${opt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !opt.isActive }),
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: 'Status updated' }); invalidateAll(); },
    onError: () => toast({ variant: 'destructive', title: 'Failed to update status' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/feedback-options/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => { toast({ title: 'Option deleted' }); invalidateAll(); },
    onError: () => toast({ variant: 'destructive', title: 'Failed to delete option' }),
  });

  // ── Category mutations ──────────────────────────────────────────────────

  const saveCategoryMutation = useMutation({
    mutationFn: async () => {
      const payload = { name: categoryName.trim(), color: categoryColor };
      const url = editCategory ? `/api/feedback-categories/${editCategory.id}` : '/api/feedback-categories';
      const r = await fetch(url, {
        method: editCategory ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
    },
    onSuccess: () => {
      toast({ title: editCategory ? 'Category updated' : 'Category created' });
      setShowCategoryDialog(false);
      invalidateCategories();
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/feedback-categories/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => { toast({ title: 'Category deleted' }); invalidateCategories(); },
    onError: () => toast({ variant: 'destructive', title: 'Failed to delete category' }),
  });

  const openCreate = () => {
    setEditOption(null);
    setLabel('');
    setDescription('');
    setCategoryId(NONE_CATEGORY);
    setShowDialog(true);
  };

  const openEdit = (opt: FeedbackOption) => {
    setEditOption(opt);
    setLabel(opt.label);
    setDescription(opt.description ?? '');
    setCategoryId(opt.categoryId ?? NONE_CATEGORY);
    setShowDialog(true);
  };

  const openCreateCategory = () => {
    setEditCategory(null);
    setCategoryName('');
    setCategoryColor(DEFAULT_CATEGORY_COLOR);
    setShowCategoryDialog(true);
  };

  const openEditCategory = (cat: FeedbackCategory) => {
    setEditCategory(cat);
    setCategoryName(cat.name);
    setCategoryColor(normalizeCategoryColor(cat.color));
    setShowCategoryDialog(true);
  };

  const activeCount   = options.filter((o) => o.isActive).length;
  const inactiveCount = options.length - activeCount;

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      {/* Header — stacks on phones so the button doesn't squeeze the title */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Manage Feedback</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define the dropdown choices agents see when submitting feedback for a lead.
            Deactivating an option hides it from new submissions but keeps historical data intact.
          </p>
        </div>
        <Button onClick={openCreate} className="w-full sm:w-auto shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          Add Value
        </Button>
      </div>

      {/* Categories */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div>
              <CardTitle className="text-base">Categories</CardTitle>
              <CardDescription>
                Group feedback values into categories like Hot, Warm, or Cold. Categories appear as
                filter pills on the All Leads page.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={openCreateCategory} className="w-full sm:w-auto shrink-0">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Category
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {categoriesLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No categories yet. Create one (e.g. &ldquo;Hot&rdquo;) to start grouping feedback values.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => {
                const tone = feedbackCategoryTone(cat.color);
                return (
                  <div
                    key={cat.id}
                    className="group flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
                    style={tone.tagStyle}
                  >
                    <span className="h-2 w-2 rounded-full shrink-0" style={tone.dotStyle} />
                    {cat.name}
                    <span className="text-[10px] font-normal opacity-70">
                      ({cat._count.feedbackOptions})
                    </span>
                    <button
                      onClick={() => openEditCategory(cat)}
                      className="ml-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:scale-110"
                      title="Edit category"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete category "${cat.name}"? Feedback values in it will become uncategorized.`)) {
                          deleteCategoryMutation.mutate(cat.id);
                        }
                      }}
                      className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:scale-110"
                      title="Delete category"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats strip */}
      <div className="flex flex-wrap gap-2 sm:gap-3">
        <div className="rounded-lg border bg-card px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">Total: </span>
          <span className="font-semibold">{options.length}</span>
        </div>
        <div className="rounded-lg border bg-card px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">Active: </span>
          <span className="font-semibold text-emerald-600">{activeCount}</span>
        </div>
        {inactiveCount > 0 && (
          <div className="rounded-lg border bg-card px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">Inactive: </span>
            <span className="font-semibold text-muted-foreground">{inactiveCount}</span>
          </div>
        )}
      </div>

      {/* List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Values</CardTitle>
          <CardDescription>
            Only <strong>active</strong> values are visible to agents. Inactive values are preserved for historical data.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : options.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No values added yet. Click &ldquo;Add Value&rdquo; to get started.
            </div>
          ) : (
            <div className="divide-y">
              {options
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((opt) => {
                  const tone = opt.category ? feedbackCategoryTone(opt.category.color) : null;
                  return (
                    <div
                      key={opt.id}
                      className={`flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3.5 transition-colors hover:bg-muted/30 ${!opt.isActive ? 'opacity-50' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className={`font-medium ${!opt.isActive ? 'line-through text-muted-foreground' : ''}`}>
                            {opt.label}
                          </p>
                          {opt.category && tone && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={tone.tagStyle}>
                              <span className="h-1.5 w-1.5 rounded-full" style={tone.dotStyle} />
                              {opt.category.name}
                            </span>
                          )}
                        </div>
                        {opt.description && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{opt.description}</p>
                        )}
                      </div>

                      {/* The toggle icon already conveys state on phones — badge is sm+ only */}
                      <Badge variant={opt.isActive ? 'default' : 'secondary'} className="hidden sm:inline-flex shrink-0 text-[10px]">
                        {opt.isActive ? 'Active' : 'Inactive'}
                      </Badge>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost" size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(opt)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="h-8 w-8"
                          onClick={() => toggleMutation.mutate(opt)}
                          title={opt.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {opt.isActive
                            ? <ToggleRight className="h-4 w-4 text-emerald-500" />
                            : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            if (confirm(`Delete "${opt.label}"? This cannot be undone.`)) {
                              deleteMutation.mutate(opt.id);
                            }
                          }}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Value Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editOption ? 'Edit Value' : 'Add Value — Manage Feedback'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="fb-label">Value <span className="text-destructive">*</span></Label>
              <Input
                id="fb-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Interested, Call Back, Not Reachable"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fb-desc">Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                id="fb-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Internal note for admins"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="— No Category —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_CATEGORY}>— No Category —</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={feedbackCategoryTone(cat.color).dotStyle} />
                        {cat.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categories.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  No categories yet — create one above to tag this value.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!label.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {editOption ? 'Save Changes' : 'Add Value'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit Category Dialog */}
      <Dialog open={showCategoryDialog} onOpenChange={setShowCategoryDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              {editCategory ? 'Edit Category' : 'Add Category'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="cat-name"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="e.g. Hot, Warm, Cold"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-color">Color</Label>
              <div className="flex items-center gap-2">
                <input
                  id="cat-color"
                  type="color"
                  value={isValidColor ? categoryColor : DEFAULT_CATEGORY_COLOR}
                  onChange={(e) => setCategoryColor(e.target.value)}
                  className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
                  title="Pick a color"
                />
                <Input
                  value={categoryColor}
                  onChange={(e) => setCategoryColor(e.target.value)}
                  placeholder="#f59e0b"
                  className="font-mono uppercase"
                  maxLength={7}
                />
              </div>
              {!isValidColor && (
                <p className="text-[11px] text-destructive">Enter a 6-digit hex color, e.g. #f59e0b</p>
              )}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {FEEDBACK_CATEGORY_PRESETS.map((hex) => {
                  const selected = categoryColor.toLowerCase() === hex;
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setCategoryColor(hex)}
                      title={hex}
                      className="relative h-6 w-6 shrink-0"
                    >
                      <span
                        style={{ backgroundColor: hex }}
                        className={cn(
                          'absolute inset-0 rounded-full transition-transform',
                          selected ? 'scale-90' : 'hover:scale-110',
                        )}
                      />
                      {selected && (
                        <motion.span
                          layoutId="color-swatch-ring"
                          className="absolute -inset-1 rounded-full ring-2 ring-offset-2 ring-foreground ring-offset-background"
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCategoryDialog(false)}>Cancel</Button>
            <Button
              onClick={() => saveCategoryMutation.mutate()}
              disabled={!categoryName.trim() || !isValidColor || saveCategoryMutation.isPending}
            >
              {saveCategoryMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {editCategory ? 'Save Changes' : 'Add Category'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
