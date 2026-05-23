/**
 * Bright Data Browser API scraping session.
 *
 * Opens one Chromium session per scan run, injects LinkedIn cookies, and
 * navigates each URL via page.goto — reusing the same page for every fetch
 * to minimise BD billing (one connect + N page loads).
 *
 * Cookies are set via CDP Network.setCookies before the first navigation.
 */

import { type Browser, type Page } from "puppeteer-core";
import { connectBrightdata, safeDisconnect } from "./brightdataBrowser";
import { retryWithBackoff, classifyPuppeteerError, classifyAllRetryable } from "./retryWithBackoff";

const LINKEDIN_DOMAINS = ["www.linkedin.com", "uk.linkedin.com", "linkedin.com"];
const MAX_HTML_BYTES = 500_000; // 500 KB cap

const AUTH_REDIRECT_PATTERNS = ["/login", "/authwall", "/checkpoint"];

function isAuthRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    return AUTH_REDIRECT_PATTERNS.some((p) => parsed.pathname.startsWith(p));
  } catch {
    return false;
  }
}

export type ScrapeResult =
  | { kind: "ok"; html: string; finalUrl: string }
  | { kind: "auth_expired"; redirectUrl: string }
  | { kind: "not_found"; status: number; finalUrl: string }
  | { kind: "transient"; error: string };

export class BrightdataScrapeSession {
  private constructor(
    private readonly browser: Browser,
    private readonly page: Page,
  ) {}

  static async create(
    env: Env,
    sessionCookies: Record<string, string>,
  ): Promise<BrightdataScrapeSession> {
    // Wrap the WSS connect in retryWithBackoff — transient connection blips
    // to the Bright Data endpoint should not immediately abort the scan.
    const browser = await retryWithBackoff(
      () => connectBrightdata(env),
      { name: "bd_wss_connect", classify: classifyAllRetryable, timeoutMs: 10_000 },
    );
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);

    // Inject cookies for all LinkedIn domains via CDP
    const cdp = await page.createCDPSession();
    const cookieParams = Object.entries(sessionCookies).flatMap(([name, value]) =>
      LINKEDIN_DOMAINS.map((domain) => ({ name, value, domain, path: "/" })),
    );
    if (cookieParams.length > 0) {
      await cdp.send("Network.setCookies", { cookies: cookieParams });
    }
    await cdp.detach();

    return new BrightdataScrapeSession(browser, page);
  }

  async fetch(url: string, acceptLanguage: string): Promise<ScrapeResult> {
    try {
      const result = await retryWithBackoff(
        async () => {
          await this.page.setExtraHTTPHeaders({ "Accept-Language": acceptLanguage });
          const response = await this.page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          });

          const finalUrl = this.page.url();

          // Auth redirect — cookie died in BD too
          if (isAuthRedirect(finalUrl)) {
            return { kind: "auth_expired" as const, redirectUrl: finalUrl };
          }

          const status = response?.status() ?? 200;

          if (status === 404 || status === 410) {
            return { kind: "not_found" as const, status, finalUrl };
          }

          let html = await this.page.content();
          if (html.length > MAX_HTML_BYTES) {
            html = html.slice(0, MAX_HTML_BYTES);
          }

          return { kind: "ok" as const, html, finalUrl };
        },
        {
          name: "bd_scrape_fetch",
          classify: classifyPuppeteerError,
          timeoutMs: 20_000,
        },
      );

      return result;
    } catch (err) {
      return { kind: "transient", error: err instanceof Error ? err.message : String(err) };
    }
  }

  async close(): Promise<void> {
    await safeDisconnect(this.browser);
  }
}
