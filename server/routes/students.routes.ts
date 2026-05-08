import { Router } from "express";
import { storage } from "../storage";
import { requireStudentLoginEnabled } from "../middlewares/auth";
import { registerStudent, verifyStudentEmail, loginStudent } from "../services/student.service";
import OpenAI from "openai";
import { getCred } from "../lib/credentials";
import { chatComplete } from "../lib/openaiClient";

export const studentsRouter = Router();

// ─── Register ──────────────────────────────────────────────────────────────────
studentsRouter.post("/api/student/register", requireStudentLoginEnabled, async (req, res) => {
  try {
    const { name, studentId, email, password, semester } = req.body;
    if (!name || !studentId || !email || !password) {
      return res.status(400).json({ message: "Name, student ID, email and password are required" });
    }
    if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

    const result = await registerStudent(name, studentId, email, password, semester || undefined);
    if (!result.ok) return res.status(result.status).json({ message: result.message });
    res.json({ message: "Registration successful! Please check your email and click the verification link to activate your account.", email: result.email });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Registration failed" });
  }
});

// ─── Verify email ─────────────────────────────────────────────────────────────
studentsRouter.get("/api/student/verify", async (req, res) => {
  try {
    const raw = String(req.query.token || "");
    if (!raw) return res.status(400).json({ message: "Missing verification token" });
    const result = await verifyStudentEmail(raw);
    if (!result.ok) return res.status(result.status).json({ message: result.message });
    res.json({ token: result.token, account: result.account });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Verification failed" });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
studentsRouter.post("/api/student/login", requireStudentLoginEnabled, async (req, res) => {
  try {
    const { studentId, password } = req.body;
    if (!studentId || !password) return res.status(400).json({ message: "Student ID and password are required" });
    const result = await loginStudent(studentId, password);
    if (!result.ok) {
      const body: any = { message: result.message };
      if (result.code) body.code = result.code;
      return res.status(result.status).json(body);
    }
    res.json({ token: result.token, account: result.account });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Login failed" });
  }
});

// ─── Get current student ─────────────────────────────────────────────────────
studentsRouter.get("/api/student/me", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ message: "Not authenticated" });
    const result = await storage.findStudentSession(token);
    if (!result) return res.status(401).json({ message: "Session expired or invalid" });
    const { account } = result;
    res.json({ id: account.id, name: account.name, studentId: account.studentId, email: account.email, semester: account.semester ?? null });
  } catch {
    res.status(500).json({ message: "Failed to get profile" });
  }
});

// ─── All groups history for the logged-in student ─────────────────────────────
studentsRouter.get("/api/student/my-groups-history", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ message: "Not authenticated" });
    const result = await storage.findStudentSession(token);
    if (!result) return res.status(401).json({ message: "Session expired or invalid" });
    const groups = await storage.getAllGroupsByStudentId(result.account.studentId);
    res.json(groups);
  } catch {
    res.status(500).json({ message: "Failed to fetch groups history" });
  }
});

// ─── My Submission (by student ID in active project) ─────────────────────────
studentsRouter.get("/api/student/my-submission", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ message: "Not authenticated" });
    const result = await storage.findStudentSession(token);
    if (!result) return res.status(401).json({ message: "Session expired or invalid" });

    const projectId = parseInt(String(req.query.projectId || ""));
    if (isNaN(projectId)) return res.status(400).json({ message: "projectId required" });

    const group = await storage.getGroupByStudentIdAndProject(result.account.studentId, projectId);
    if (!group) return res.status(404).json({ message: "No submission found" });
    res.json(group);
  } catch {
    res.status(500).json({ message: "Failed to look up submission" });
  }
});

// ─── Virtual Room: AI topic explanation ───────────────────────────────────────
studentsRouter.post("/api/student/virtual-room/explain", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ message: "Not authenticated" });
    const result = await storage.findStudentSession(token);
    if (!result) return res.status(401).json({ message: "Session expired or invalid" });

    const { topic } = req.body;
    if (!topic || typeof topic !== "string" || topic.trim().length < 2) {
      return res.status(400).json({ message: "Please provide a valid topic" });
    }

    const trimmedTopic = topic.trim().slice(0, 200);

    const completion = await chatComplete({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `You are a friendly, detailed academic tutor for university students.
Given a topic, return ONLY valid JSON (no markdown fences, no extra text) with these fields:

title: string — clean display title for the topic
summary: string — 3-4 sentence detailed plain-English overview explaining the concept thoroughly
keyPoints: array of 5-6 objects, each with "heading" (short bold label) and "detail" (2-3 sentence thorough explanation)
realWorldExample: string — a concrete, relatable real-world example or analogy (3-4 sentences) that makes the concept click for a student
quickFact: string — one surprising or interesting fact about this topic
searchQueries: array of 4 strings — specific YouTube search queries to find educational videos on this topic

IMPORTANT: Every field must have substantial content. Do not leave any field empty. Write detailed, helpful explanations that would genuinely help a student understand the topic. Use simple everyday language.`
        },
        {
          role: "user",
          content: `Explain this study topic in detail: "${trimmedTopic}"`
        }
      ],
      max_completion_tokens: 2500,
    });

    const finishReason = completion.finish_reason;
    let raw = completion.reply || "";
    console.log("AI finish_reason:", finishReason, "| raw length:", raw.length, "| provider:", completion.provider);

    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

    if (finishReason === "length" || !raw) {
      console.error("Virtual room AI: response truncated or empty");
      return res.status(502).json({ message: "AI response was incomplete. Please try again." });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("Virtual room AI: invalid JSON:", raw.slice(0, 200));
      return res.status(502).json({ message: "AI returned an invalid response. Please try again." });
    }

    if (!parsed.summary && !parsed.keyPoints?.length) {
      console.error("Virtual room AI: empty content from model");
      return res.status(502).json({ message: "AI returned empty content. Please try again." });
    }

    const safe = {
      title: typeof parsed.title === "string" && parsed.title ? parsed.title : trimmedTopic,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      keyPoints: Array.isArray(parsed.keyPoints)
        ? parsed.keyPoints.filter((k: any) => k && typeof k.heading === "string" && typeof k.detail === "string").slice(0, 8)
        : [],
      realWorldExample: typeof parsed.realWorldExample === "string" ? parsed.realWorldExample : "",
      quickFact: typeof parsed.quickFact === "string" ? parsed.quickFact : "",
      searchQueries: Array.isArray(parsed.searchQueries)
        ? parsed.searchQueries.filter((s: any) => typeof s === "string" && s.trim()).slice(0, 4)
        : [],
    };
    res.json(safe);
  } catch (err: any) {
    console.error("Virtual room AI error:", err?.message);
    res.status(500).json({ message: "AI explanation failed. Please try again." });
  }
});

// ─── Virtual Room: YouTube video search ──────────────────────────────────────
studentsRouter.get("/api/student/virtual-room/videos", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ message: "Not authenticated" });
    const result = await storage.findStudentSession(token);
    if (!result) return res.status(401).json({ message: "Session expired or invalid" });

    const query = String(req.query.q || "").trim();
    if (!query || query.length < 2) return res.status(400).json({ message: "Query required" });

    const apiKey = getCred("YOUTUBE_API_KEY");

    // Preferred path: official YouTube Data API v3 (requires YOUTUBE_API_KEY).
    if (apiKey) {
      const url =
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=4` +
        `&safeSearch=strict&videoEmbeddable=true&q=${encodeURIComponent(query)}&key=${apiKey}`;
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const data: any = await resp.json();
          const videos = (data.items || [])
            .map((it: any) => ({
              videoId: it?.id?.videoId,
              title: it?.snippet?.title || "Untitled",
              channel: it?.snippet?.channelTitle || "",
              thumbnail:
                it?.snippet?.thumbnails?.medium?.url ||
                (it?.id?.videoId ? `https://i.ytimg.com/vi/${it.id.videoId}/mqdefault.jpg` : ""),
            }))
            .filter((v: any) => v.videoId)
            .slice(0, 4);
          return res.json({ videos });
        }
        const errText = await resp.text();
        console.error("[youtube-api] non-OK:", resp.status, errText.slice(0, 300));
        // fall through to scraper fallback
      } catch (apiErr: any) {
        console.error("[youtube-api] failed, falling back to scraper:", apiErr?.message);
      }
    }

    // Fallback: scrape youtube.com search page (no API key needed, fragile).
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
    const resp = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await resp.text();

    const dataMatch = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!dataMatch) {
      return res.json({ videos: [] });
    }

    let ytData: any;
    try { ytData = JSON.parse(dataMatch[1]); } catch { return res.json({ videos: [] }); }

    const videos: { videoId: string; title: string; channel: string; thumbnail: string }[] = [];
    const contents = ytData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    if (Array.isArray(contents)) {
      for (const section of contents) {
        const items = section?.itemSectionRenderer?.contents;
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const vr = item?.videoRenderer;
          if (!vr?.videoId) continue;
          videos.push({
            videoId: vr.videoId,
            title: vr.title?.runs?.[0]?.text || "Untitled",
            channel: vr.ownerText?.runs?.[0]?.text || "",
            thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`,
          });
          if (videos.length >= 4) break;
        }
        if (videos.length >= 4) break;
      }
    }

    res.json({ videos });
  } catch (err: any) {
    console.error("Video search error:", err?.message);
    res.json({ videos: [] });
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────────
studentsRouter.post("/api/student/logout", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token) await storage.deleteStudentSession(token);
    res.json({ message: "Logged out" });
  } catch {
    res.status(500).json({ message: "Logout failed" });
  }
});
