import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Layers,
  Globe,
  UserPlus,
  BookOpen,
  Menu,
  Scale,
  Check,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@workspace/ui/components/sheet";
import { Button } from "@workspace/ui/components/button";
import { getSession } from "@/lib/auth-helpers";
import { env } from "@/lib/env";

type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

type RepoStats = {
  stars: number;
  forks: number;
};

const REPO_STATS_TTL_MS = 60 * 60 * 1000;
let repoStatsCache: { value: Result<RepoStats>; expiresAt: number } | null = null;

async function getRepoStats(): Promise<Result<RepoStats>> {
  const now = Date.now();
  if (repoStatsCache && repoStatsCache.expiresAt > now) {
    return repoStatsCache.value;
  }

  try {
    const response = await fetch(
      "https://api.github.com/repos/lakubuDavid/mini-cms",
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(2000),
      },
    );
    if (!response.ok) {
      const error = new Error(`GitHub responded with ${response.status}`);
      repoStatsCache = {
        value: { success: false, error },
        expiresAt: now + 5 * 60 * 1000,
      };
      return { success: false, error };
    }

    const data = (await response.json()) as {
      stargazers_count?: number;
      forks_count?: number;
    };
    const value = {
      success: true as const,
      value: {
        stars: data.stargazers_count ?? 0,
        forks: data.forks_count ?? 0,
      },
    };
    repoStatsCache = { value, expiresAt: now + REPO_STATS_TTL_MS };
    return value;
  } catch (error) {
    const value = {
      success: false as const,
      error: error instanceof Error ? error : new Error("Unknown GitHub error"),
    };
    repoStatsCache = { value, expiresAt: now + 5 * 60 * 1000 };
    return value;
  }
}

export const Route = createFileRoute("/")({
  loader: async () => {
    if (env.PUBLIC_HIDE_HOME) {
      throw new Response("Not Found", { status: 404 });
    }

    const [session, repoStats] = await Promise.all([
      getSession(),
      getRepoStats(),
    ]);
    return { isLoggedIn: !!session, repoStats };
  },
  head: () => ({
    meta: [
      {
        title: "Mini CMS — A minimal self-hosted CMS for development studios",
      },
      {
        name: "description",
        content:
          "Mini CMS is a self-hosted, open-source CMS for development agencies. Manage projects, teams, and structured content collections with a quiet dashboard, a clean public API, and a developer-friendly CLI.",
      },
      { name: "keywords", content: "cms, self-hosted, headless, content management, tanstack, turso, cli" },
      { name: "robots", content: "index, follow" },
      {
        property: "og:title",
        content: "Mini CMS — A minimal self-hosted CMS for development studios",
      },
      {
        property: "og:description",
        content:
          "Self-hosted, open-source CMS for development agencies. Projects, teams, structured collections, a public API, and a CLI.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: env.PUBLIC_APP_URL },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "canonical", href: env.PUBLIC_APP_URL },
      {
        rel: "icon",
        href: "/favicon.ico",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ_ITEMS.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: {
              "@type": "Answer",
              text: item.a,
            },
          })),
        }),
      },
    ],
  }),
  component: HomePage,
});

const DASHBOARD_VIEWS = [
  {
    title: "Dashboard overview",
    description:
      "A quiet home for the workspace: recent projects, collection counts, and the state of your content at a glance.",
    src: "/screenshots/landing/carousel/01-dashboard.png",
  },
  {
    title: "Projects",
    description:
      "Portfolio work and client engagements in one list, with status, owner, and links to the content behind each project.",
    src: "/screenshots/landing/carousel/02-projects.png",
  },
  {
    title: "Team",
    description:
      "Invite collaborators, review roles, and keep dashboard access centralized without a separate user database.",
    src: "/screenshots/landing/carousel/03-team.png",
  },
  {
    title: "Assets",
    description:
      "Upload and reuse images across collections. Assets stay addressable, so your public API can point at them directly.",
    src: "/screenshots/landing/carousel/04-assets.png",
  },
  {
    title: "Analytics",
    description:
      "See which collections are growing and how often your public API is read, without wiring up another analytics tool.",
    src: "/screenshots/landing/carousel/05-analytics.png",
  },
  {
    title: "API keys",
    description:
      "Workspace-scoped keys for the schema API and CLI, with expiry dates and rotation handled from the dashboard.",
    src: "/screenshots/landing/carousel/06-api-keys.png",
  },
] as const;

const FAQ_ITEMS = [
  {
    q: "Is Mini CMS a hosted service?",
    a: "No. Mini CMS is open-source software you deploy to your own infrastructure. You provide the Turso database and the hosting target (Vercel, Cloudflare Pages, Fly.io, a VPS, etc.).",
  },
  {
    q: "What does it cost to run?",
    a: "Turso has a generous free tier (500 MB, 1 GB/month egress). Most small projects stay on the free tier. Vercel's hobby tier is also free. Total cost is effectively $0 for typical agency workloads.",
  },
  {
    q: "Can I use it with Next.js / Astro / Remix?",
    a: "Yes. The public API endpoint GET /api/collections/:slug returns JSON and works with any framework that can fetch HTTP. The CLI generates TypeScript types for your collections.",
  },
  {
    q: "How does authentication work?",
    a: "Admins create invite links sent via Resend. Recipients sign up with Better Auth and receive a dashboard role. API keys are workspace-scoped and rotate automatically.",
  },
  {
    q: "What content types are supported?",
    a: "Four field types: text, url (renders as thumbnail + modal), number, and boolean.",
  },
] as const;

function HomePage() {
  const { isLoggedIn, repoStats } = Route.useLoaderData();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeView, setActiveView] = useState(0);
  const starCount = repoStats.success ? repoStats.value.stars : 0;
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const userSelectedRef = useRef(false);

  // CSS owns scrolling and snapping. This only reads which card the browser
  // snapped to and syncs the matching image.
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const cards = Array.from(
      list.querySelectorAll<HTMLButtonElement>("[data-view-index]"),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!mostVisible) {
          return;
        }
        const index = Number(
          (mostVisible.target as HTMLElement).dataset.viewIndex,
        );
        if (!Number.isNaN(index)) {
          setActiveView(index);
        }
      },
      { root: list, threshold: [0.5, 0.75, 1] },
    );
    for (const card of cards) {
      observer.observe(card);
    }
    return () => observer.disconnect();
  }, []);

  // Explicit selections scroll the list; observer updates must not.
  useEffect(() => {
    if (!userSelectedRef.current) {
      return;
    }
    userSelectedRef.current = false;
    activeTabRef.current?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [activeView]);

  return (
    <main className="min-h-svh bg-[radial-gradient(circle_at_top_left,_rgba(24,24,27,0.08),_transparent_32%),linear-gradient(180deg,_#f7f4ee_0%,_#f3efe8_100%)] text-stone-900 dark:bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.04),_transparent_32%),linear-gradient(180deg,_#0a0a0a_0%,_#111_100%)] dark:text-stone-100">
      <section className="mx-auto flex min-h-svh max-w-7xl flex-col justify-between px-5 py-6 md:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-900 text-white dark:bg-white dark:text-stone-900">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-stone-500 dark:text-stone-400">
                Self-hosted CMS
              </p>
              <p className="text-lg font-semibold tracking-tight">Mini CMS</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {/* Desktop actions */}
            <div className="hidden items-center gap-3 md:flex">
              <a
                href={env.PUBLIC_DOCS_URL}
                target="_blank"
                className="flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:border-stone-900 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-400 dark:hover:text-white"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Docs
              </a>
              {isLoggedIn ? (
                <Link
                  to="/dashboard"
                  search={{ projectId: undefined }}
                  className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-stone-700 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
                >
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    to="/login"
                    search={{ redirect: undefined }}
                    className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:border-stone-900 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-400 dark:hover:text-white"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/signup"
                    search={{ redirect: undefined }}
                    className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-stone-700 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
                  >
                    Create account
                  </Link>
                </>
              )}
            </div>
            {/* Mobile hamburger */}
            <div className="md:hidden">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Open menu"
                    className="rounded-full"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-72">
                  <nav className="flex flex-col gap-3 pt-12">
                    <a
                      href={env.PUBLIC_DOCS_URL}
                      target="_blank"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
                    >
                      <BookOpen className="h-4 w-4" />
                      Docs
                    </a>
                    {isLoggedIn ? (
                      <Link
                        to="/dashboard"
                        search={{ projectId: undefined }}
                        onClick={() => setMobileOpen(false)}
                        className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 dark:bg-white dark:text-stone-900"
                      >
                        Dashboard
                      </Link>
                    ) : (
                      <>
                        <Link
                          to="/login"
                          search={{ redirect: undefined }}
                          onClick={() => setMobileOpen(false)}
                          className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium hover:border-stone-900 dark:border-stone-700"
                        >
                          Sign in
                        </Link>
                        <Link
                          to="/signup"
                          search={{ redirect: undefined }}
                          onClick={() => setMobileOpen(false)}
                          className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 dark:bg-white dark:text-stone-900"
                        >
                          Create account
                        </Link>
                      </>
                    )}
                  </nav>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </header>

        {/* Hero + CTA + illustration */}
        <section
          aria-label="Hero"
          className="grid gap-10 py-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:gap-16 lg:py-16"
        >
          <div className="min-w-0">
            <p className="text-sm uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
              For development studios
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight text-stone-950 sm:text-5xl md:text-7xl dark:text-stone-50">
              A minimal CMS for projects, teams, and a clean public API.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-stone-600 md:text-lg dark:text-stone-400">
              Manage portfolio work, team members, and structured content collections from one quiet dashboard — built with TanStack Start, Turso, Drizzle, Better Auth, and Resend.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/dashboard"
                search={{ projectId: undefined }}
                className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 dark:bg-stone-50 dark:text-stone-950 dark:hover:bg-stone-200"
              >
                Get started
                <Layers className="h-4 w-4" />
              </Link>
              <a
                href="https://github.com/lakubuDavid/mini-cms"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-6 py-3 text-sm font-medium text-stone-900 shadow-sm transition hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:border-stone-500"
              >
                View on GitHub
                <GithubMark className="h-4 w-4" />
              </a>
            </div>
            <div className="mt-6 max-w-xl">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400">
                Quick start
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-stone-950 px-4 py-3 text-xs text-stone-100">
                <code>{`git clone https://github.com/lakubuDavid/mini-cms
cd mini-cms && bun install`}</code>
              </pre>
            </div>
          </div>

          <figure className="relative overflow-hidden rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl dark:border-stone-800 dark:bg-stone-900 md:p-8">
            <img
              src="/transhumans%20art/SVG/Pondering.svg"
              alt="Illustration of a coworking figure considering a structured board"
              className="h-auto w-full object-cover mix-blend-multiply dark:mix-blend-screen dark:brightness-128"
              loading="eager"
            />
          </figure>
        </section>

        {/* Project facts */}
        <section
          aria-label="Project facts"
          className="border-y border-stone-200 py-6 dark:border-stone-800"
        >
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400">
                License
              </dt>
              <dd className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-50">
                Apache-2.0
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400">
                {starCount > 0 ? "GitHub stars" : "Open source"}
              </dt>
              <dd className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-50">
                {starCount > 0 ? starCount.toLocaleString("en-US") : "Yes"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400">
                Field types
              </dt>
              <dd className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-50">
                4
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400">
                API cache
              </dt>
              <dd className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-50">
                60s
              </dd>
            </div>
          </dl>
        </section>

        {/* Vertical dashboard carousel: text left, matching image right */}
        <section aria-label="Product screenshots" className="py-14 lg:py-20">
          <header className="mb-8 max-w-2xl">
            <p className="text-sm uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
              The dashboard
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950 md:text-4xl dark:text-stone-50">
              Every view, in one quiet place.
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
              Select a view to see what it looks like — the description always matches the screenshot.
            </p>
          </header>

          <div className="grid gap-8 lg:h-[440px] lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
            <div className="flex min-h-0 gap-3 lg:h-full">
              <div
                ref={listRef}
                role="tablist"
                aria-label="Dashboard views"
                aria-orientation="vertical"
                className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain py-10 pr-1 [scrollbar-width:none] lg:snap-y lg:snap-mandatory [&::-webkit-scrollbar]:hidden"
              >
              {DASHBOARD_VIEWS.map((view, index) => {
                const isActive = index === activeView;
                return (
                  <button
                    key={view.title}
                    ref={isActive ? activeTabRef : undefined}
                    data-view-index={index}
                    type="button"
                    role="tab"
                    id={`dashboard-tab-${index}`}
                    aria-selected={isActive}
                    aria-controls={`dashboard-panel-${index}`}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => {
                      userSelectedRef.current = true;
                      setActiveView(index);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        userSelectedRef.current = true;
                        setActiveView((index + 1) % DASHBOARD_VIEWS.length);
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        userSelectedRef.current = true;
                        setActiveView(
                          (index - 1 + DASHBOARD_VIEWS.length) %
                            DASHBOARD_VIEWS.length,
                        );
                      }
                    }}
                    className={`group flex w-full items-start gap-4 rounded-xl border p-4 text-left transition lg:min-h-[360px] lg:snap-center lg:snap-always lg:items-center ${
                      isActive
                        ? "border-stone-900 bg-white shadow-md dark:border-stone-100 dark:bg-stone-900"
                        : "border-transparent bg-transparent hover:border-stone-200 hover:bg-white/60 dark:hover:border-stone-800 dark:hover:bg-stone-900/60"
                    }`}
                  >
                    <span
                      className={`mt-0.5 font-mono text-xs ${
                        isActive
                          ? "text-stone-900 dark:text-stone-100"
                          : "text-stone-400 dark:text-stone-500"
                      }`}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block text-base font-semibold tracking-tight ${
                          isActive
                            ? "text-stone-950 dark:text-stone-50"
                            : "text-stone-700 dark:text-stone-300"
                        }`}
                      >
                        {view.title}
                      </span>
                      <span
                        className={`mt-1 block text-sm leading-6 ${
                          isActive
                            ? "text-stone-600 dark:text-stone-400"
                            : "text-stone-500 dark:text-stone-500"
                        }`}
                      >
                        {view.description}
                      </span>
                    </span>
                  </button>
                );
              })}
              </div>

              <div
                aria-hidden="true"
                className="flex flex-col items-center justify-center gap-2"
              >
                {DASHBOARD_VIEWS.map((view, index) => (
                  <button
                    key={view.title}
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      userSelectedRef.current = true;
                      setActiveView(index);
                    }}
                    className={`w-2 rounded-full transition-all ${
                      index === activeView
                        ? "h-6 bg-stone-900 dark:bg-stone-100"
                        : "h-2 bg-stone-300 hover:bg-stone-400 dark:bg-stone-700 dark:hover:bg-stone-500"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="relative order-first lg:order-none lg:h-full">
              {DASHBOARD_VIEWS.map((view, index) => (
                <figure
                  key={view.title}
                  role="tabpanel"
                  id={`dashboard-panel-${index}`}
                  aria-labelledby={`dashboard-tab-${index}`}
                  hidden={index !== activeView}
                  className="h-full overflow-hidden rounded-xl border border-stone-200 shadow-2xl dark:border-stone-800"
                >
                  <img
                    src={view.src}
                    alt={`Mini CMS — ${view.title}`}
                    className="h-full w-full object-cover object-left-top"
                    loading="lazy"
                  />
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section aria-label="Capabilities" className="py-14 lg:py-20">
          <header className="mb-8 max-w-2xl">
            <p className="text-sm uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
              Capabilities
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950 md:text-4xl dark:text-stone-50">
              Everything a small studio needs — nothing it doesn't.
            </h2>
          </header>
          <div className="grid gap-4 md:grid-cols-3">
            <FeatureCard
              icon={<Layers className="h-5 w-5" />}
              title="Collections"
              description="Generic tables for projects, team members, testimonials, and future content models."
            />
            <FeatureCard
              icon={<Globe className="h-5 w-5" />}
              title="Public API"
              description="Expose collection data through workspace-scoped endpoints with pagination, caching, and rate limiting."
            />
            <FeatureCard
              icon={<UserPlus className="h-5 w-5" />}
              title="Invite flow"
              description="Send invite links to collaborators and keep dashboard access centralized."
            />
          </div>
        </section>

        {/* How it works */}
        <section aria-label="How it works" className="py-14 lg:py-20">
          <header className="mb-10 max-w-2xl">
            <p className="text-sm uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950 md:text-4xl dark:text-stone-50">
              From database to API in three steps.
            </h2>
          </header>
          <ol className="grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Connect your database",
                description:
                  "Add TURSO_DB_URL and TURSO_AUTH_TOKEN to .env, then apply the schema to your Turso database.",
              },
              {
                title: "Model your content",
                description:
                  "Create collections and text, url, number, or boolean fields from the dashboard — no code required.",
              },
              {
                title: "Read it anywhere",
                description:
                  "Fetch GET /api/collections/:slug from any frontend, or sync types locally with the CLI.",
              },
            ].map((step, index) => (
              <li
                key={step.title}
                className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-900 text-sm font-semibold text-white dark:bg-stone-50 dark:text-stone-950">
                  {index + 1}
                </span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-stone-950 dark:text-stone-50">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Self-hosting / cost band */}
        <section
          aria-label="Self-hosting"
          className="grid gap-10 py-14 lg:grid-cols-[0.7fr_1.3fr] lg:items-center lg:gap-16"
        >
          <figure className="relative overflow-hidden rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl dark:border-stone-800 dark:bg-stone-900 md:p-8">
            <img
              src="/transhumans%20art/SVG/Pilot.svg"
              alt="Illustration of a pilot guiding a self-hosted vessel"
              className="h-auto w-full object-cover mix-blend-multiply dark:mix-blend-screen dark:brightness-128"
              loading="lazy"
            />
          </figure>
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
              Self-hosted by default
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950 md:text-4xl dark:text-stone-50">
              Your data, your infrastructure, your bill.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-stone-600 md:text-lg dark:text-stone-400">
              Mini CMS runs on your Turso database and your Vercel (or any Node) deployment. No SaaS subscription, no vendor lock-in — just a tiny open-source app you own.
            </p>
            <ul className="mt-6 space-y-3 text-base leading-7 text-stone-600 dark:text-stone-400">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-stone-400" />
                <span>Apache-2.0 license — free for commercial use</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-stone-400" />
                <span>One SQLite-compatible database (Turso) — pennies at scale</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-stone-400" />
                <span>Edge-ready, serverless-first — deploy to Vercel, Cloudflare, Fly, or a VPS</span>
              </li>
            </ul>
          </div>
        </section>

        {/* CLI & Public API section */}
        <section
          aria-label="CLI and public API"
          className="grid gap-10 py-14 lg:grid-cols-[1.3fr_0.7fr] lg:items-center lg:gap-16"
        >
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
              Developer experience
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950 md:text-4xl dark:text-stone-50">
              A CLI for schema sync and a public API for your frontends.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-stone-600 md:text-lg dark:text-stone-400">
              <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-sm dark:bg-stone-800">mini-cms schema pull</code> and <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-sm dark:bg-stone-800">mini-cms schema push</code> keep your local types in sync with the dashboard. The public <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-sm dark:bg-stone-800">GET /api/collections/:slug</code> endpoint is cached, rate-limited, and ready for your Astro, Next, or Remix site.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <p className="text-xs uppercase tracking-[0.1em] text-stone-500 dark:text-stone-400">Schema pull</p>
                <pre className="mt-2 overflow-x-auto rounded-md bg-stone-950 p-3 text-xs text-stone-100"><code>mini-cms schema pull --project=acme</code></pre>
              </div>
              <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <p className="text-xs uppercase tracking-[0.1em] text-stone-500 dark:text-stone-400">Public API example</p>
                <pre className="mt-2 overflow-x-auto rounded-md bg-stone-950 p-3 text-xs text-stone-100"><code>GET /api/collections/projects?w=100&p=1</code></pre>
              </div>
            </div>
          </div>
          <figure className="relative overflow-hidden rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl dark:border-stone-800 dark:bg-stone-900 md:p-8">
            <img
              src="/transhumans%20art/SVG/Cube%20Leg.svg"
              alt="Illustration of a developer connecting modular blocks"
              className="h-auto w-full object-cover mix-blend-multiply dark:mix-blend-screen dark:brightness-128"
              loading="lazy"
            />
          </figure>
        </section>

        {/* Audience / handoff section */}
        <section aria-label="Who it's for" className="py-14 lg:py-20">
          <header className="mb-10 max-w-2xl">
            <p className="text-sm uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
              Built for
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950 md:text-4xl dark:text-stone-50">
              Development studios that hand off content to clients.
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
              You build the project. Your client manages the content. Mini CMS gives you a quiet dashboard for them and clean data for you.
            </p>
          </header>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[
              { title: "Agencies", desc: "Portfolio projects, case studies, team bios — all structured." },
              { title: "Freelancers", desc: "Spin up a CMS for a client in minutes, not hours." },
              { title: "Internal tools", desc: "Replace spreadsheets with typed collections and an API." },
              { title: "Side projects", desc: "Zero monthly cost. Deploy once, run indefinitely." },
            ].map((a, i) => (
              <article
                key={i}
                className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-stone-800 dark:bg-stone-900"
              >
                <h3 className="text-lg font-semibold tracking-tight text-stone-950 dark:text-stone-50">
                  {a.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                  {a.desc}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section aria-label="Frequently asked questions" className="py-14 lg:py-20">
          <header className="mb-10 max-w-2xl">
            <p className="text-sm uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
              FAQ
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950 md:text-4xl dark:text-stone-50">
              Common questions
            </h2>
          </header>
          <dl className="grid gap-4 md:grid-cols-2">
            {FAQ_ITEMS.map((f, i) => (
              <div key={i} className="rounded-xl border border-stone-200 p-5 dark:border-stone-800">
                <dt className="font-semibold text-stone-950 dark:text-stone-50">{f.q}</dt>
                <dd className="mt-2 text-base leading-7 text-stone-600 dark:text-stone-400">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Closing CTA */}
        <section aria-label="Closing call to action" className="py-14 lg:py-20">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-stone-950 md:text-4xl dark:text-stone-50">
              Ready to stop wrangling spreadsheets?
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600 md:text-lg dark:text-stone-400">
              Clone the repo, add your Turso credentials, and deploy. Your first collection is live in minutes.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href="https://github.com/lakubuDavid/mini-cms"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 dark:bg-stone-50 dark:text-stone-950 dark:hover:bg-stone-200"
              >
                View on GitHub
                <GithubMark className="h-4 w-4" />
              </a>
              <a
                href={env.PUBLIC_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-6 py-3 text-sm font-medium text-stone-900 shadow-sm transition hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:border-stone-500"
              >
                Read the docs
                <BookOpen className="h-4 w-4" />
              </a>
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-4 border-t border-stone-200 py-6 text-sm text-stone-500 md:flex-row md:items-center md:justify-between dark:border-stone-800 dark:text-stone-500">
          <div className="flex flex-col gap-1">
            <p>Minimal surface. Structured content. Self-hosted by default.</p>
            <p className="text-xs text-stone-400 dark:text-stone-600">
              Serverless-ready for Vercel and similar runtimes.
            </p>
          </div>
          <nav
            aria-label="Project links"
            className="flex flex-wrap items-center gap-x-5 gap-y-2"
          >
            <a
              href="https://github.com/lakubuDavid/mini-cms"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 transition hover:text-stone-900 dark:hover:text-stone-200"
            >
              <GithubMark className="h-3.5 w-3.5" />
              GitHub
            </a>
            <a
              href="https://github.com/lakubuDavid/mini-cms/blob/main/LICENSE.md"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 transition hover:text-stone-900 dark:hover:text-stone-200"
            >
              <Scale className="h-3.5 w-3.5" />
              Apache-2.0 License
            </a>
          </nav>
        </footer>
      </section>
    </main>
  );
}

function FeatureCard(props: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="group rounded-3xl border border-stone-200 bg-white/80 p-5 shadow-sm backdrop-blur transition hover:shadow-md dark:border-stone-800 dark:bg-stone-900/80 dark:hover:border-stone-700">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-100 text-stone-600 transition group-hover:bg-stone-900 group-hover:text-white dark:bg-stone-800 dark:text-stone-300 dark:group-hover:bg-white dark:group-hover:text-stone-900">
          {props.icon}
        </div>
        <h3 className="text-lg font-semibold tracking-tight text-stone-950 dark:text-stone-50">
          {props.title}
        </h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-400">
        {props.description}
      </p>
    </div>
  );
}

function GithubMark(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={props.className}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
