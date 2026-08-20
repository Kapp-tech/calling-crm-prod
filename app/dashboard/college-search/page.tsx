'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Loader2, MapPin, ChevronRight, FileText, ExternalLink,
  GraduationCap, Building2, Layers, Sparkles,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PaginationBar } from '@/components/shared/pagination-bar';
import { cn } from '@/lib/utils';
import type {
  LmsCollegeSearchResult, LmsCourseGroup, LmsCourse, LmsBrochure,
} from '@/lib/lms-api';

interface CollegeSearchApiResponse {
  data: LmsCollegeSearchResult[];
  total: number;
  page: number;
  limit: number;
}

/** A course group enriched with how many individual courses it contains — computed server-side, see app/api/college-search/course-groups/route.ts. */
type CourseGroupRow = LmsCourseGroup & { courseCount: number };

function formatFee(min: string | null, max: string | null): string {
  const minN = min ? Number(min) : null;
  const maxN = max ? Number(max) : null;
  if (!minN && !maxN) return 'Not available';
  if (minN && maxN && minN !== maxN) {
    return `₹${minN.toLocaleString('en-IN')} – ₹${maxN.toLocaleString('en-IN')}`;
  }
  const v = (minN ?? maxN)!;
  return `₹${v.toLocaleString('en-IN')}`;
}

/**
 * Renders a duration using the unit the LMS reports, not an assumed one.
 *
 * This used to hardcode years, which was wrong for the courses measured in
 * months or days. The unit now comes from `duration_type`.
 *
 * The plural is recomputed rather than trusted: the upstream data contains both
 * "1 Year" and "2 Year", so echoing the field verbatim would print the second of
 * those. Deriving it from the number keeps the two consistent.
 *
 * With no `duration_type` the number is shown bare — inventing a unit on a fee
 * table a student is quoted from is worse than leaving it off.
 */
function formatDuration(duration: string | null, durationType: string | null): string {
  if (!duration) return '—';
  const unit = (durationType ?? '').trim();
  if (!unit) return duration;
  const singular = unit.replace(/s$/i, '');
  return `${duration} ${Number(duration) === 1 ? singular : `${singular}s`}`;
}

/** A dedicated, clearly-labeled section — never crammed inline next to a title. */
function BrochureSection({ brochures }: { brochures: LmsBrochure[] }) {
  if (!brochures.length) return null;
  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <FileText className="h-3 w-3" /> Brochures
      </p>
      <div className="flex flex-wrap gap-2">
        {brochures.map((b, i) => (
          <a
            key={i}
            href={b.brochure_file}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="group inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <FileText className="h-3.5 w-3.5 text-primary" />
            </span>
            <span className="whitespace-nowrap">{b.brochure_title}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
          </a>
        ))}
      </div>
    </div>
  );
}

function MetaPill({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 text-[11px] font-medium text-muted-foreground">
      <Icon className="h-3 w-3" /> {children}
    </span>
  );
}

function LoadingBlock() {
  return (
    <div className="flex flex-col items-center gap-3 py-20">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-xs text-muted-foreground">Fetching live catalog data…</p>
    </div>
  );
}

/**
 * College logo with a graceful fallback to the generic building icon when the
 * URL is missing or fails to load.
 *
 * Uses a plain <img>, not next/image, deliberately: the LMS serves logos from
 * several hosts (S3, CloudFront, assets.kollegeapply.com), each of which would
 * need whitelisting in next.config.js — and would break silently if a new host
 * appeared. It also avoids routing every logo through server-side image
 * optimisation on a memory-constrained box for no real gain at this size.
 *
 * The tile is white because logos are authored for light backgrounds and many
 * are transparent PNGs.
 */
function CollegeLogo({
  src,
  className,
  iconClassName,
}: {
  src: string | null | undefined;
  className?: string;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = src?.trim();
  const showImage = !!url && !failed;

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-white',
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- plain <img> is deliberate; see the note above this component.
        <img
          src={url}
          // Decorative: the college name always sits right beside it.
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-1"
        />
      ) : (
        <Building2 className={cn('text-primary', iconClassName)} />
      )}
    </div>
  );
}

type Level = 'colleges' | 'course-groups' | 'courses';

export default function CollegeSearchPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const [selectedCollege, setSelectedCollege] = useState<LmsCollegeSearchResult | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<CourseGroupRow | null>(null);
  const [groupFilter, setGroupFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');

  // No shared debounce hook in this codebase — ad-hoc setTimeout matches the
  // convention used by the Lead Integration builder's lead search.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const level: Level = selectedGroup ? 'courses' : selectedCollege ? 'course-groups' : 'colleges';

  const collegesQuery = useQuery<CollegeSearchApiResponse>({
    queryKey: ['college-search', debouncedSearch, page, limit],
    queryFn: () =>
      fetch(`/api/college-search?search=${encodeURIComponent(debouncedSearch)}&page=${page}&limit=${limit}`).then((r) => r.json()),
    placeholderData: (prev) => prev,
  });

  const groupsQuery = useQuery<{ data: CourseGroupRow[] }>({
    queryKey: ['college-course-groups', selectedCollege?.college_id],
    queryFn: () => fetch(`/api/college-search/course-groups?collegeId=${selectedCollege!.college_id}`).then((r) => r.json()),
    enabled: !!selectedCollege,
  });

  const coursesQuery = useQuery<{ data: LmsCourse[] }>({
    queryKey: ['college-courses', selectedCollege?.college_id, selectedGroup?.course_group_id],
    queryFn: () =>
      fetch(`/api/college-search/courses?collegeId=${selectedCollege!.college_id}&courseGroupId=${selectedGroup!.course_group_id}`).then((r) => r.json()),
    enabled: !!selectedCollege && !!selectedGroup,
  });

  const colleges = collegesQuery.data?.data ?? [];
  const total = collegesQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const groups = groupsQuery.data?.data ?? [];
  const filteredGroups = useMemo(() => {
    const q = groupFilter.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => g.course_group_name.toLowerCase().includes(q) || g.course_group_full_name.toLowerCase().includes(q)
    );
  }, [groups, groupFilter]);

  const courses = coursesQuery.data?.data ?? [];
  const filteredCourses = useMemo(() => {
    const q = courseFilter.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) => c.course_name.toLowerCase().includes(q));
  }, [courses, courseFilter]);

  function resetToColleges() {
    setSelectedCollege(null);
    setSelectedGroup(null);
    setGroupFilter('');
    setCourseFilter('');
  }
  function resetToGroups() {
    setSelectedGroup(null);
    setCourseFilter('');
  }

  return (
    <div className="space-y-5">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div className="relative flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Search className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
              College/Course Search
              <Sparkles className="h-4 w-4 text-primary/70" />
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Search colleges, browse course groups, and pull up fees &amp; brochures — live from the KollegeApply catalog.
            </p>
          </div>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
        <button
          type="button"
          onClick={resetToColleges}
          className={cn(
            'rounded-md px-2 py-0.5 font-medium transition-colors',
            level === 'colleges' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          All Colleges
        </button>
        {selectedCollege && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <button
              type="button"
              onClick={resetToGroups}
              className={cn(
                'max-w-[240px] truncate rounded-md px-2 py-0.5 font-medium transition-colors',
                level === 'course-groups' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {selectedCollege.college_name}
            </button>
          </>
        )}
        {selectedGroup && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">{selectedGroup.course_group_name}</span>
          </>
        )}
      </div>

      {level === 'colleges' && (
        <>
          <div className="relative max-w-lg">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by college name, city, or state…"
              className="h-11 rounded-xl pl-10 shadow-sm"
            />
          </div>

          {total > 0 && !collegesQuery.isLoading && (
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{total.toLocaleString('en-IN')}</span> college{total === 1 ? '' : 's'}
              {debouncedSearch ? (
                <>
                  {' '}
                  matching <span className="font-medium text-foreground">&quot;{debouncedSearch}&quot;</span>
                </>
              ) : (
                ' in the catalog'
              )}
            </p>
          )}

          {collegesQuery.isLoading ? (
            <LoadingBlock />
          ) : colleges.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-20 text-center">
              <Building2 className="h-9 w-9 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No colleges found</p>
              {debouncedSearch && <p className="text-xs text-muted-foreground/70">Try a different name, city, or state.</p>}
            </div>
          ) : (
            <div className={cn('grid grid-cols-1 gap-3 transition-opacity lg:grid-cols-2', collegesQuery.isFetching && 'opacity-60')}>
              {colleges.map((c) => (
                <button
                  key={c.college_id}
                  type="button"
                  onClick={() => {
                    setSelectedCollege(c);
                    setGroupFilter('');
                  }}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                >
                  <CollegeLogo src={c.logo_img} className="h-10 w-10" iconClassName="h-5 w-5" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold leading-tight">{c.college_name}</p>
                    {c.short_name && c.short_name !== c.college_name && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.short_name}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {(c.city_name || c.state_name) && (
                        <MetaPill icon={MapPin}>{[c.city_name, c.state_name].filter(Boolean).join(', ')}</MetaPill>
                      )}
                      {c.brochures.length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          <FileText className="h-3 w-3" /> {c.brochures.length} brochure{c.brochures.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" />
                </button>
              ))}
            </div>
          )}

          {total > 0 && (
            <PaginationBar
              page={page}
              totalPages={totalPages}
              total={total}
              limit={limit}
              onPageChange={setPage}
              onLimitChange={setLimit}
              disabled={collegesQuery.isFetching}
            />
          )}
        </>
      )}

      {level === 'course-groups' && selectedCollege && (
        <>
          {/* College info card — name/location and brochures live in clearly separated zones */}
          <div className="space-y-3 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <CollegeLogo src={selectedCollege.logo_img} className="h-12 w-12 rounded-xl shadow-sm" iconClassName="h-6 w-6" />
              <div className="min-w-0">
                <h2 className="text-base font-bold leading-tight sm:text-lg">{selectedCollege.college_name}</h2>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" /> {[selectedCollege.city_name, selectedCollege.state_name].filter(Boolean).join(', ') || 'Location not available'}
                </p>
              </div>
            </div>
            <BrochureSection brochures={selectedCollege.brochures} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} placeholder="Filter course groups…" className="h-10 rounded-xl pl-10" />
            </div>
            {groups.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Layers className="h-3.5 w-3.5" /> {groups.length} course group{groups.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {groupsQuery.isLoading ? (
            <LoadingBlock />
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-20 text-center">
              <GraduationCap className="h-9 w-9 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">
                {groups.length === 0 ? 'No course groups listed for this college' : 'No course groups match your filter'}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-primary text-primary-foreground">
                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wider">Courses</th>
                      <th className="px-5 py-3 text-center text-xs font-bold uppercase tracking-wider">Duration</th>
                      <th className="px-5 py-3 text-center text-xs font-bold uppercase tracking-wider">Total Fees</th>
                      <th className="px-5 py-3 text-center text-xs font-bold uppercase tracking-wider">Eligibility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGroups.map((g, i) => (
                      <tr
                        key={g.course_group_id}
                        onClick={() => {
                          setSelectedGroup(g);
                          setCourseFilter('');
                        }}
                        className={cn(
                          'cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-primary/5',
                          i % 2 === 1 && 'bg-muted/20'
                        )}
                      >
                        <td className="px-5 py-4 align-top">
                          <p className="font-semibold text-primary">{g.course_group_full_name || g.course_group_name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {g.courseCount} course{g.courseCount === 1 ? '' : 's'}
                          </p>
                          {g.brochures.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {g.brochures.map((b, bi) => (
                                <a
                                  key={bi}
                                  href={b.brochure_file}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={b.brochure_title}
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex h-5 w-5 items-center justify-center rounded bg-emerald-500/10 text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
                                >
                                  <FileText className="h-3 w-3" />
                                </a>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 text-center align-top">
                          <span className="text-foreground">{formatDuration(g.duration, g.duration_type)}</span>
                        </td>
                        <td className="px-5 py-4 text-center align-top">
                          <span className="font-semibold text-foreground">{formatFee(g.min_fees, g.max_fees)}</span>
                        </td>
                        <td className="px-5 py-4 text-center align-top">
                          <p className="text-foreground">{g.eligibility || '—'}</p>
                          {g.exam_accepted.length > 0 && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Exams :{' '}
                              <span className="font-medium text-primary">
                                {g.exam_accepted.map((e) => e.name).join(', ')}
                              </span>
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {level === 'courses' && selectedCollege && selectedGroup && (
        <>
          <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-4 sm:p-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-tight sm:text-lg">{selectedGroup.course_group_full_name || selectedGroup.course_group_name}</h2>
              <p className="mt-1 truncate text-xs text-muted-foreground">{selectedCollege.college_name}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} placeholder="Filter courses…" className="h-10 rounded-xl pl-10" />
            </div>
            {courses.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <GraduationCap className="h-3.5 w-3.5" /> {courses.length} course{courses.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {coursesQuery.isLoading ? (
            <LoadingBlock />
          ) : filteredCourses.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-20 text-center">
              <GraduationCap className="h-9 w-9 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">
                {courses.length === 0 ? 'No individual courses listed for this group' : 'No courses match your filter'}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-primary text-primary-foreground">
                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wider">Course</th>
                      <th className="px-5 py-3 text-center text-xs font-bold uppercase tracking-wider">Duration</th>
                      <th className="px-5 py-3 text-center text-xs font-bold uppercase tracking-wider">Total Fees</th>
                      <th className="px-5 py-3 text-center text-xs font-bold uppercase tracking-wider">Exams Accepted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCourses.map((c, i) => (
                      <tr
                        key={c.course_id}
                        className={cn('border-b border-border/60 transition-colors last:border-0 hover:bg-primary/5', i % 2 === 1 && 'bg-muted/20')}
                      >
                        <td className="px-5 py-4 align-top">
                          <p className="font-semibold text-primary">{c.course_name}</p>
                          {c.brochures.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {c.brochures.map((b, bi) => (
                                <a
                                  key={bi}
                                  href={b.brochure_file}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={b.brochure_title}
                                  className="flex h-5 w-5 items-center justify-center rounded bg-emerald-500/10 text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
                                >
                                  <FileText className="h-3 w-3" />
                                </a>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 text-center align-top">
                          {/* The course's own duration, not the group's — courses in
                              one group can differ, and this previously showed the
                              group's figure against every row. */}
                          <span className="text-foreground">
                            {formatDuration(
                              c.duration ?? selectedGroup.duration,
                              c.duration_type ?? selectedGroup.duration_type,
                            )}
                          </span>
                          {c.course_mode && <p className="mt-0.5 text-xs text-muted-foreground">{c.course_mode}</p>}
                        </td>
                        <td className="px-5 py-4 text-center align-top">
                          <span className="font-semibold text-foreground">{formatFee(c.min_fees, c.max_fees)}</span>
                        </td>
                        <td className="px-5 py-4 text-center align-top">
                          {c.exam_accepted.length > 0 ? (
                            <span className="font-medium text-primary">{c.exam_accepted.map((e) => e.name).join(', ')}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
