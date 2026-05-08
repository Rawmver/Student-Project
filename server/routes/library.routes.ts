/**
 * Student Library — book / PDF search.
 *
 * Primary source : Google Books API v1 (rich filters + previews + free PDFs).
 * Fallback source: Open Library (free, no key, links to Internet Archive PDFs).
 *
 * The route is intentionally simple: it forwards filter params to Google
 * Books, normalises results, and (for any book that doesn't already expose
 * a free PDF) optionally enriches with an Open Library lookup.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { getCred } from "../lib/credentials";

export const libraryRouter = Router();

async function requireStudent(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ message: "Not authenticated" });
  const result = await storage.findStudentSession(token);
  if (!result) return res.status(401).json({ message: "Session expired or invalid" });
  next();
}

const searchSchema = z.object({
  q:         z.string().trim().max(200).optional(),
  title:     z.string().trim().max(200).optional(),
  author:    z.string().trim().max(200).optional(),
  publisher: z.string().trim().max(200).optional(),
  subject:   z.string().trim().max(100).optional(),
  isbn:      z.string().trim().max(20).optional(),
  yearFrom:  z.coerce.number().int().min(0).max(3000).optional(),
  yearTo:    z.coerce.number().int().min(0).max(3000).optional(),
  language:  z.string().trim().length(2).optional(),
  freeOnly:  z.union([z.literal("true"), z.literal("false")]).optional(),
  page:      z.coerce.number().int().min(1).max(50).default(1),
});

interface NormalisedBook {
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
  pdfDownloadUrl?: string;     // direct download (Google PDF or Internet Archive)
  pdfSource?: "google" | "openlibrary";
  isFreePublicDomain: boolean;
}

const PAGE_SIZE = 12;

libraryRouter.get("/api/student/library/search", requireStudent, async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid search parameters", issues: parsed.error.issues });
  }
  const f = parsed.data;

  // Build Google Books advanced query (`q=foo+intitle:bar+inauthor:baz`).
  const parts: string[] = [];
  if (f.q)         parts.push(f.q);
  if (f.title)     parts.push(`intitle:${quote(f.title)}`);
  if (f.author)    parts.push(`inauthor:${quote(f.author)}`);
  if (f.publisher) parts.push(`inpublisher:${quote(f.publisher)}`);
  if (f.subject)   parts.push(`subject:${quote(f.subject)}`);
  if (f.isbn)      parts.push(`isbn:${f.isbn.replace(/[^0-9Xx]/g, "")}`);

  if (parts.length === 0) {
    return res.json({ books: [], totalItems: 0, page: f.page, pageSize: PAGE_SIZE });
  }

  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", parts.join("+"));
  url.searchParams.set("maxResults", String(PAGE_SIZE));
  url.searchParams.set("startIndex", String((f.page - 1) * PAGE_SIZE));
  url.searchParams.set("printType", "books");
  if (f.language)            url.searchParams.set("langRestrict", f.language);
  if (f.freeOnly === "true") url.searchParams.set("filter", "free-ebooks");
  const apiKey = getCred("GOOGLE_BOOKS_API_KEY");
  if (apiKey) url.searchParams.set("key", apiKey);

  let books: NormalisedBook[] = [];
  let totalItems = 0;
  try {
    const r = await fetch(url.toString());
    if (!r.ok) {
      const body = await r.text();
      console.error("[library] Google Books error:", r.status, body.slice(0, 200));
      // Google returns 403 with reasons "quotaExceeded" / "dailyLimitExceeded"
      // when the per-day quota is hit. 429 is rate-limit (per-second).
      const isQuota = r.status === 429 || (r.status === 403 && /quota|dailyLimit|rateLimit/i.test(body));
      return res.status(502).json({
        message: isQuota
          ? "Daily book-search quota reached. Ask the admin to set or upgrade the Google Books API key in Admin → Credentials."
          : "Book search service is currently unavailable. Please try again shortly.",
      });
    }
    const data = await r.json();
    totalItems = data.totalItems || 0;
    books = (data.items || []).map(normaliseGoogleBook);
  } catch (err: any) {
    console.error("[library] Google Books fetch failed:", err?.message);
    return res.status(502).json({ message: "Could not reach Google Books." });
  }

  // Year-range filter is applied to the current page only — Google Books has
  // NO native year filter, so the unfiltered totalItems and pagination remain
  // approximate when a year range is set. The UI shows a hint to the user.
  const yearFilterActive = f.yearFrom !== undefined || f.yearTo !== undefined;
  if (f.yearFrom !== undefined) books = books.filter(b => (b.publishedYear ?? 0) >= f.yearFrom!);
  if (f.yearTo   !== undefined) books = books.filter(b => (b.publishedYear ?? 9999) <= f.yearTo!);

  // Open Library fallback — for any book WITHOUT a Google PDF, try the
  // Open Library / Internet Archive lookup. We do this in parallel and tolerate
  // failures silently (it's enrichment, not the primary result).
  const candidates = books.filter(b => !b.pdfDownloadUrl && b.isbn);
  await Promise.all(candidates.map(async b => {
    try {
      const olUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${b.isbn}&format=json&jscmd=data`;
      const r = await fetch(olUrl, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) return;
      const data = await r.json();
      const entry = data[`ISBN:${b.isbn}`];
      if (!entry) return;
      // Internet Archive identifier → free PDF / borrow link.
      const iaId: string | undefined = entry.ebooks?.[0]?.preview_url || entry.ebooks?.[0]?.read_url;
      if (iaId) {
        b.pdfDownloadUrl = iaId;
        b.pdfSource = "openlibrary";
        b.isFreePublicDomain = true;
      }
    } catch { /* ignore */ }
  }));

  res.json({ books, totalItems, page: f.page, pageSize: PAGE_SIZE, yearFilterActive });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function quote(v: string) {
  // Google Books accepts quoted phrases for multi-word filters.
  return v.includes(" ") ? `"${v.replace(/"/g, "")}"` : v;
}

function normaliseGoogleBook(item: any): NormalisedBook {
  const v = item.volumeInfo || {};
  const a = item.accessInfo || {};
  const s = item.saleInfo || {};

  const isbn13 = (v.industryIdentifiers || []).find((i: any) => i.type === "ISBN_13")?.identifier;
  const isbn10 = (v.industryIdentifiers || []).find((i: any) => i.type === "ISBN_10")?.identifier;

  const yearMatch = (v.publishedDate || "").match(/^(\d{4})/);
  const publishedYear = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

  const isPublicDomain = a.publicDomain === true || s.saleability === "FREE";
  const pdfLink: string | undefined = a.pdf?.isAvailable
    ? (a.pdf?.acsTokenLink || a.pdf?.downloadLink || a.webReaderLink)
    : undefined;

  // Convert the (often http://) thumbnail to https so it loads on https sites.
  const rawThumb = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail;
  const thumbnail = rawThumb ? rawThumb.replace(/^http:\/\//, "https://") : undefined;

  return {
    id: item.id,
    title: v.title || "Untitled",
    subtitle: v.subtitle,
    authors: v.authors || [],
    publisher: v.publisher,
    publishedYear,
    description: v.description,
    pageCount: v.pageCount,
    categories: v.categories || [],
    language: v.language,
    isbn: isbn13 || isbn10,
    rating: v.averageRating,
    ratingsCount: v.ratingsCount,
    thumbnail,
    previewLink: v.previewLink,
    infoLink: v.infoLink,
    pdfDownloadUrl: pdfLink,
    pdfSource: pdfLink ? "google" : undefined,
    isFreePublicDomain: isPublicDomain,
  };
}
