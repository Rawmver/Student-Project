import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookOpen, Search, SlidersHorizontal, Download, Eye, ExternalLink, Loader2, Star, ChevronDown } from "lucide-react";

interface Book {
  id: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisher?: string;
  publishedYear?: number;
  description?: string;
  pageCount?: number;
  categories: string[];
  language?: string;
  isbn?: string;
  rating?: number;
  ratingsCount?: number;
  thumbnail?: string;
  previewLink?: string;
  infoLink?: string;
  pdfDownloadUrl?: string;
  pdfSource?: "google" | "openlibrary";
  isFreePublicDomain: boolean;
}

interface SearchResponse { books: Book[]; totalItems: number; page: number; pageSize: number; yearFilterActive?: boolean; }

interface Filters {
  q: string;
  title: string;
  author: string;
  publisher: string;
  subject: string;
  isbn: string;
  yearFrom: string;
  yearTo: string;
  language: string;
  freeOnly: boolean;
}

const EMPTY: Filters = { q: "", title: "", author: "", publisher: "", subject: "", isbn: "", yearFrom: "", yearTo: "", language: "any", freeOnly: false };

const LANGS: { value: string; label: string }[] = [
  { value: "any", label: "Any language" },
  { value: "en", label: "English" },
  { value: "bn", label: "Bengali" },
  { value: "hi", label: "Hindi" },
  { value: "ar", label: "Arabic" },
  { value: "ur", label: "Urdu" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "zh", label: "Chinese" },
];

const SUBJECTS = ["Computer Science", "Mathematics", "Physics", "Chemistry", "Biology", "Engineering", "Medicine", "Business", "Economics", "Literature", "History", "Philosophy", "Psychology", "Art", "Music"];

export function LibraryTab({ studentToken }: { studentToken: string }) {
  const [draft, setDraft] = React.useState<Filters>(EMPTY);
  const [active, setActive] = React.useState<Filters | null>(null);
  const [page, setPage] = React.useState(1);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [previewBook, setPreviewBook] = React.useState<Book | null>(null);

  // A search needs at least one text term OR the "free only" toggle (which can
  // legitimately be a standalone "browse all free books" query).
  const hasTextTerm = active && Object.entries(active).some(([k, v]) => k !== "language" && k !== "freeOnly" && typeof v === "string" && v.trim().length > 0);
  const hasAnyTerm = !!(active && (hasTextTerm || active.freeOnly));

  const { data, isLoading, isError, error } = useQuery<SearchResponse>({
    queryKey: ["/api/student/library/search", active, page],
    queryFn: async () => {
      if (!active || !hasAnyTerm) return { books: [], totalItems: 0, page: 1, pageSize: 12 };
      const params = new URLSearchParams();
      // When only freeOnly is set, send a broad "*" so Google has something to
      // match against — otherwise it returns nothing.
      if (!hasTextTerm && active.freeOnly) params.set("subject", "fiction");
      Object.entries(active).forEach(([k, v]) => {
        if (k === "freeOnly") { if (v) params.set("freeOnly", "true"); return; }
        if (k === "language" && (v === "any" || !v)) return;
        if (typeof v === "string" && v.trim().length > 0) params.set(k, v.trim());
      });
      params.set("page", String(page));
      const res = await fetch(`/api/student/library/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Search failed");
      return res.json();
    },
    enabled: !!active && hasAnyTerm,
  });

  const onSearch = () => { setPage(1); setActive({ ...draft }); };
  const onReset = () => { setDraft(EMPTY); setActive(null); setPage(1); };
  const totalPages = data ? Math.min(50, Math.ceil((data.totalItems || 0) / data.pageSize) || 1) : 1;

  const activeFilterCount = Object.entries(draft).filter(([k, v]) => {
    if (k === "q") return false;
    if (k === "freeOnly") return v === true;
    if (k === "language") return v && v !== "any";
    return typeof v === "string" && v.trim().length > 0;
  }).length;

  return (
    <div className="space-y-4 pb-4">
      <div className="text-center mb-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 mb-2 shadow-md">
          <BookOpen className="w-7 h-7 text-white" />
        </div>
        <h2 className="text-lg font-bold text-gray-900">Library</h2>
        <p className="text-xs text-gray-500">Search millions of books — read previews, download free PDFs</p>
      </div>

      {/* Quick search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Book name, author, or topic…"
            value={draft.q}
            onChange={e => setDraft({ ...draft, q: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") onSearch(); }}
            className="pl-9"
            data-testid="input-library-q"
          />
        </div>
        <Button onClick={onSearch} disabled={isLoading} data-testid="button-library-search">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
        </Button>
      </div>

      {/* Filters drawer */}
      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full justify-between" data-testid="button-library-toggle-filters">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4" />
              Advanced filters
              {activeFilterCount > 0 && <Badge className="ml-1 bg-violet-600 hover:bg-violet-600">{activeFilterCount}</Badge>}
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Title contains"><Input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Algorithms" data-testid="input-library-title" /></Field>
                <Field label="Author name"><Input value={draft.author} onChange={e => setDraft({ ...draft, author: e.target.value })} placeholder="e.g. Cormen" data-testid="input-library-author" /></Field>
                <Field label="Publisher"><Input value={draft.publisher} onChange={e => setDraft({ ...draft, publisher: e.target.value })} placeholder="e.g. MIT Press" data-testid="input-library-publisher" /></Field>
                <Field label="ISBN (10 or 13)"><Input value={draft.isbn} onChange={e => setDraft({ ...draft, isbn: e.target.value })} placeholder="e.g. 9780262033848" data-testid="input-library-isbn" /></Field>
                <Field label="Subject / Category">
                  <Select value={draft.subject || "any"} onValueChange={v => setDraft({ ...draft, subject: v === "any" ? "" : v })}>
                    <SelectTrigger data-testid="select-library-subject"><SelectValue placeholder="Any subject" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any subject</SelectItem>
                      {SUBJECTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Language">
                  <Select value={draft.language} onValueChange={v => setDraft({ ...draft, language: v })}>
                    <SelectTrigger data-testid="select-library-language"><SelectValue /></SelectTrigger>
                    <SelectContent>{LANGS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Year from"><Input type="number" min={0} max={3000} value={draft.yearFrom} onChange={e => setDraft({ ...draft, yearFrom: e.target.value })} placeholder="e.g. 2010" data-testid="input-library-year-from" /></Field>
                <Field label="Year to"><Input type="number" min={0} max={3000} value={draft.yearTo} onChange={e => setDraft({ ...draft, yearTo: e.target.value })} placeholder="e.g. 2024" data-testid="input-library-year-to" /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 pt-1 cursor-pointer select-none">
                <input type="checkbox" checked={draft.freeOnly} onChange={e => setDraft({ ...draft, freeOnly: e.target.checked })} className="w-4 h-4 accent-violet-600" data-testid="checkbox-library-free-only" />
                Show only free / downloadable books
              </label>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={onReset} className="flex-1" data-testid="button-library-reset">Clear</Button>
                <Button onClick={onSearch} className="flex-1" data-testid="button-library-apply">Apply</Button>
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Results */}
      {!active && <EmptyState message="Type a book name, author, or topic above to start searching." />}

      {isError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4 text-sm text-red-700">{(error as Error)?.message || "Search failed"}</CardContent>
        </Card>
      )}

      {isLoading && active && (
        <div className="flex items-center justify-center py-10 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Searching…</div>
      )}

      {data && active && data.books.length === 0 && !isLoading && (
        <EmptyState message="No books matched. Try fewer or different filters." />
      )}

      {data && data.books.length > 0 && (
        <>
          <div className="px-1 space-y-1">
            <p className="text-xs text-gray-500" data-testid="text-library-count">
              About {data.totalItems.toLocaleString()} results — page {data.page} of {totalPages}
            </p>
            {data.yearFilterActive && (
              <p className="text-[11px] text-amber-600">
                Year filter is approximate — Google Books has no native year filter, so it's applied to this page's results only.
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.books.map(b => <BookCard key={b.id} book={b} onPreview={() => setPreviewBook(b)} />)}
          </div>
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || isLoading} onClick={() => setPage(p => Math.max(1, p - 1))} data-testid="button-library-prev">← Previous</Button>
            <span className="text-xs text-gray-500">Page {page}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages || isLoading} onClick={() => setPage(p => p + 1)} data-testid="button-library-next">Next →</Button>
          </div>
        </>
      )}

      <BookPreviewDialog book={previewBook} onClose={() => setPreviewBook(null)} />
    </div>
  );
}

function BookPreviewDialog({ book, onClose }: { book: Book | null; onClose: () => void }) {
  // Prefer the free PDF (rendered in-iframe) when available; otherwise use
  // Google Books' embedded viewer which works for any volume that allows preview.
  // For PDFs we route through Google Docs viewer which streams pages on demand
  // (much faster first paint than loading a multi-MB PDF in the browser's
  // built-in viewer all at once).
  const pdfUrl = book?.pdfDownloadUrl;
  const embedUrl = book ? `https://books.google.com/books?id=${encodeURIComponent(book.id)}&printsec=frontcover&output=embed` : "";
  const src = pdfUrl
    ? `https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(pdfUrl)}`
    : embedUrl;

  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => { setLoading(true); }, [book?.id]);

  return (
    <Dialog open={!!book} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl w-[95vw] h-[90vh] p-0 flex flex-col gap-0">
        <DialogHeader className="p-4 pb-2 border-b">
          <DialogTitle className="text-base pr-8 line-clamp-1" data-testid="text-preview-title">{book?.title || "Preview"}</DialogTitle>
          {book?.authors?.length ? (
            <p className="text-xs text-gray-500 line-clamp-1">{book.authors.join(", ")}</p>
          ) : null}
        </DialogHeader>
        <div className="flex-1 min-h-0 bg-gray-100 relative">
          {book && (
            <>
              <iframe
                key={book.id}
                src={src}
                title={book.title}
                className="w-full h-full border-0"
                allow="fullscreen"
                onLoad={() => setLoading(false)}
                data-testid="iframe-book-preview"
              />
              {loading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50/90 backdrop-blur-sm pointer-events-none">
                  <Loader2 className="w-6 h-6 animate-spin text-violet-500 mb-2" />
                  <p className="text-xs text-gray-500">{pdfUrl ? "Loading PDF…" : "Loading preview…"}</p>
                </div>
              )}
            </>
          )}
        </div>
        {book && pdfUrl && (
          <div className="px-4 py-2 border-t flex items-center justify-end gap-2">
            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer" data-testid="button-preview-download"><Download className="w-3 h-3 mr-1" /> Download PDF</a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-gray-600">{label}</Label>{children}</div>;
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="pt-8 pb-8 flex flex-col items-center text-center text-gray-500">
        <BookOpen className="w-10 h-10 mb-2 text-gray-300" />
        <p className="text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}

function BookCard({ book, onPreview }: { book: Book; onPreview: () => void }) {
  const hasFreePdf = !!book.pdfDownloadUrl;
  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow" data-testid={`card-book-${book.id}`}>
      <CardContent className="p-3">
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-20 h-28 rounded-md bg-gray-100 overflow-hidden flex items-center justify-center">
            {book.thumbnail
              ? <img src={book.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover" />
              : <BookOpen className="w-8 h-8 text-gray-300" />}
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <h3 className="font-semibold text-sm leading-tight line-clamp-2" data-testid={`text-book-title-${book.id}`}>{book.title}</h3>
            {book.authors.length > 0 && <p className="text-xs text-gray-600 line-clamp-1">{book.authors.join(", ")}</p>}
            <p className="text-[11px] text-gray-500 line-clamp-1">
              {[book.publisher, book.publishedYear].filter(Boolean).join(" · ")}
            </p>
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              {book.rating !== undefined && (
                <span className="inline-flex items-center text-[11px] text-amber-600 gap-0.5">
                  <Star className="w-3 h-3 fill-current" /> {book.rating.toFixed(1)}
                </span>
              )}
              {hasFreePdf && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px] px-1.5 py-0">Free PDF</Badge>}
              {book.isFreePublicDomain && !hasFreePdf && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Public domain</Badge>}
            </div>
          </div>
        </div>
        {book.description && <p className="text-xs text-gray-600 mt-2 line-clamp-2">{book.description}</p>}
        <div className="flex gap-1.5 mt-3">
          {hasFreePdf && (
            <Button asChild size="sm" className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-700" data-testid={`button-book-pdf-${book.id}`}>
              <a href={book.pdfDownloadUrl} target="_blank" rel="noopener noreferrer"><Download className="w-3 h-3 mr-1" /> PDF</a>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onPreview} className="flex-1 h-8 text-xs" data-testid={`button-book-preview-${book.id}`}>
            <Eye className="w-3 h-3 mr-1" /> Preview
          </Button>
          {book.infoLink && (
            <Button asChild size="sm" variant="outline" className="h-8 text-xs px-2" data-testid={`button-book-info-${book.id}`}>
              <a href={book.infoLink} target="_blank" rel="noopener noreferrer" title="More info on Google Books"><ExternalLink className="w-3 h-3" /></a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
