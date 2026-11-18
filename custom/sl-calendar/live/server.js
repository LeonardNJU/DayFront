// src/app.ts
import { randomUUID as randomUUID4 } from "crypto";
import { resolve } from "path";
import express from "express";

// src/auth.ts
import {
  createCipheriv,
  createDecipheriv,
  createHash as createHash2,
  randomBytes
} from "crypto";

// src/caldav/client.ts
import { createHash } from "crypto";

// src/caldav/errors.ts
var CalDavError = class extends Error {
  constructor(code, message, status, options) {
    super(message, options);
    this.code = code;
    this.status = status;
    this.name = "CalDavError";
  }
  code;
  status;
};

// src/caldav/xml.ts
import { XMLParser } from "fast-xml-parser";
var parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) => ["response", "propstat", "comp"].includes(name)
});
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function text(value) {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  const object = record(value);
  return object ? text(object["#text"]) : void 0;
}
function parseMultiStatus(xml) {
  let document;
  try {
    document = parser.parse(xml);
  } catch (error) {
    throw new CalDavError(
      "CALDAV_PROTOCOL_ERROR",
      "CalDAV server returned malformed XML.",
      void 0,
      { cause: error }
    );
  }
  const root = record(document);
  const multistatus = record(root?.multistatus);
  const responses = multistatus?.response;
  // Stalwart returns an empty valid DAV multistatus for calendars with no VTODO items.
  if (root && Object.hasOwn(root, "multistatus") && (responses === undefined || responses === null || responses === "")) return [];
  if (!Array.isArray(responses)) {
    throw new CalDavError(
      "CALDAV_PROTOCOL_ERROR",
      "CalDAV response was not a DAV multistatus."
    );
  }
  return responses.flatMap((item) => {
    const response = record(item);
    const href = text(response?.href);
    const propstats = response?.propstat;
    if (!href || !Array.isArray(propstats)) return [];
    const entries = propstats;
    const successful = entries.find((entry) => {
      const status = text(record(entry)?.status);
      return status?.includes(" 200 ") ?? false;
    });
    const properties = record(record(successful)?.prop);
    return properties ? [{ href, properties }] : [];
  });
}
function propertyHref(properties, name) {
  return text(record(properties[name])?.href ?? properties[name]);
}
function hasProperty(properties, container, name) {
  const value = record(properties[container]);
  return value !== void 0 && Object.hasOwn(value, name);
}
function componentNames(properties) {
  const supported = record(properties["supported-calendar-component-set"]);
  const components = supported?.comp;
  if (!Array.isArray(components)) return [];
  return components.flatMap((component) => {
    const name = record(component)?.["@_name"];
    return name === "VEVENT" || name === "VTODO" || name === "VJOURNAL" ? [name] : [];
  });
}

// src/caldav/client.ts
var discoveryBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
var homeBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`;
var calendarsBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ical="http://apple.com/ns/ical/">
  <d:prop><d:resourcetype/><d:displayname/><d:getetag/><c:calendar-description/><c:supported-calendar-component-set/><ical:calendar-color/><cs:getctag/></d:prop>
</d:propfind>`;
var CalDavClient = class {
  constructor(config2, options = {}) {
    this.config = config2;
    this.baseUrl = new URL(
      config2.url.endsWith("/") ? config2.url : `${config2.url}/`
    );
    this.authorization = `Basic ${Buffer.from(`${config2.username}:${config2.password}`).toString("base64")}`;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }
  config;
  baseUrl;
  authorization;
  fetchImplementation;
  async discover() {
    const principalProperties = await this.propfind(
      this.baseUrl.href,
      "0",
      discoveryBody
    );
    const principalHref = propertyHref(
      this.firstProperties(principalProperties, "current-user-principal"),
      "current-user-principal"
    );
    if (!principalHref)
      this.protocolError(
        "CalDAV server did not provide a current-user-principal."
      );
    const principalUrl = this.resolveHref(principalHref).href;
    const homeProperties = await this.propfind(principalUrl, "0", homeBody);
    const homeHref = propertyHref(
      this.firstProperties(homeProperties, "calendar-home-set"),
      "calendar-home-set"
    );
    if (!homeHref)
      this.protocolError("CalDAV server did not provide a calendar-home-set.");
    const calendarHomeUrl = this.resolveHref(homeHref).href;
    const collections = await this.propfind(
      calendarHomeUrl,
      "1",
      calendarsBody
    );
    const calendars = collections.flatMap(
      ({ href, properties }) => {
        if (!hasProperty(properties, "resourcetype", "calendar")) return [];
        const url = this.resolveHref(href).href;
        const displayName = text(properties.displayname) ?? new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "Calendar";
        const description = text(properties["calendar-description"]);
        const color = text(properties["calendar-color"]);
        return [
          {
            id: createHash("sha256").update(url).digest("base64url").slice(0, 22),
            url,
            displayName,
            ...description ? { description } : {},
            ...color ? { color } : {},
            components: componentNames(properties)
          }
        ];
      }
    );
    return { principalUrl, calendarHomeUrl, calendars };
  }
  async queryCalendar(calendarUrl, start, end) {
    this.assertRange(start, end);
    const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${this.dateTime(start)}" end="${this.dateTime(end)}"/></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
    const response = await this.request(calendarUrl, {
      method: "REPORT",
      headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
      body
    });
    this.expectStatus(response, [207]);
    const resources = parseMultiStatus(await response.text());
    return resources.flatMap(({ href, properties }) => {
      const etag = text(properties.getetag);
      const calendarData = text(properties["calendar-data"]);
      if (!etag || !calendarData) return [];
      return [{ url: this.resolveHref(href).href, etag, calendarData }];
    });
  }
  async searchCalendar(calendarUrl, query) {
    const summaryFilter = query ? `<c:prop-filter name="SUMMARY"><c:text-match collation="i;unicode-casemap">${this.xml(query)}</c:text-match></c:prop-filter>` : "";
    const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">${summaryFilter}</c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
    const response = await this.request(calendarUrl, {
      method: "REPORT",
      headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
      body
    });
    this.expectStatus(response, [207]);
    const resources = parseMultiStatus(await response.text());
    return resources.flatMap(({ href, properties }) => {
      const etag = text(properties.getetag);
      const calendarData = text(properties["calendar-data"]);
      return etag && calendarData ? [{ url: this.resolveHref(href).href, etag, calendarData }] : [];
    });
  }
  async queryTasks(calendarUrl, start, end) {
    if (start && !end || !start && end)
      this.protocolError("Task range requires both start and end.");
    if (start && end) this.assertRange(start, end);
    const timeRange = start && end ? `<c:time-range start="${this.dateTime(start)}" end="${this.dateTime(end)}"/>` : "";
    const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO">${timeRange}</c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
    const response = await this.request(calendarUrl, {
      method: "REPORT",
      headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
      body
    });
    this.expectStatus(response, [207]);
    const resources = parseMultiStatus(await response.text());
    return resources.flatMap(({ href, properties }) => {
      const etag = text(properties.getetag);
      const calendarData = text(properties["calendar-data"]);
      return etag && calendarData ? [{ url: this.resolveHref(href).href, etag, calendarData }] : [];
    });
  }
  async getResource(resourceUrl2) {
    const response = await this.request(resourceUrl2, { method: "GET" });
    this.expectStatus(response, [200]);
    const etag = response.headers.get("etag");
    if (!etag)
      this.protocolError("Calendar resource response did not include an ETag.");
    return {
      url: this.resolveHref(resourceUrl2).href,
      etag,
      calendarData: await response.text()
    };
  }
  async putResource(resourceUrl2, calendarData, etag) {
    const response = await this.request(resourceUrl2, {
      method: "PUT",
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        ...etag ? { "If-Match": etag } : { "If-None-Match": "*" }
      },
      body: calendarData
    });
    this.expectStatus(response, [201, 204]);
    return response.headers.get("etag") ?? etag ?? "";
  }
  async deleteResource(resourceUrl2, etag) {
    const response = await this.request(resourceUrl2, {
      method: "DELETE",
      headers: { "If-Match": etag }
    });
    if (!response.ok) this.expectStatus(response, []);
  }
  async createCalendar(calendarHomeUrl, calendarUrl, input) {
    const home = this.resolveHref(calendarHomeUrl);
    const target = this.resolveHref(calendarUrl);
    if (!target.pathname.startsWith(home.pathname) || target.href === home.href)
      this.protocolError("New calendar URL is outside the calendar home.");
    const components = input.components.map((component) => `<c:comp name="${component}"/>`).join("");
    const body = `<?xml version="1.0" encoding="utf-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ical="http://apple.com/ns/ical/">
  <d:set><d:prop>
    <d:displayname>${this.xml(input.name)}</d:displayname>
    <c:calendar-description>${this.xml(input.description ?? "")}</c:calendar-description>
    ${input.color ? `<ical:calendar-color>${this.xml(input.color)}</ical:calendar-color>` : ""}
    <c:supported-calendar-component-set>${components}</c:supported-calendar-component-set>
  </d:prop></d:set>
</c:mkcalendar>`;
    const response = await this.request(target.href, {
      method: "MKCALENDAR",
      headers: { "Content-Type": "application/xml; charset=utf-8" },
      body
    });
    this.expectStatus(response, [201, 204]);
  }
  async updateCalendar(calendarUrl, input) {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ical="http://apple.com/ns/ical/">
  <d:set><d:prop>
    <d:displayname>${this.xml(input.name)}</d:displayname>
    <c:calendar-description>${this.xml(input.description ?? "")}</c:calendar-description>
    ${input.color ? `<ical:calendar-color>${this.xml(input.color)}</ical:calendar-color>` : ""}
    <c:supported-calendar-component-set>${input.components.map((component) => `<c:comp name="${component}"/>`).join("")}</c:supported-calendar-component-set>
  </d:prop></d:set>
  ${input.color ? "" : "<d:remove><d:prop><ical:calendar-color/></d:prop></d:remove>"}
</d:propertyupdate>`;
    const response = await this.request(calendarUrl, {
      method: "PROPPATCH",
      headers: { "Content-Type": "application/xml; charset=utf-8" },
      body
    });
    this.expectStatus(response, [207]);
  }
  async deleteCalendar(calendarUrl) {
    const response = await this.request(calendarUrl, { method: "DELETE" });
    if (!response.ok) this.expectStatus(response, []);
  }
  async propfind(url, depth, body) {
    const response = await this.request(url, {
      method: "PROPFIND",
      headers: {
        Depth: depth,
        "Content-Type": "application/xml; charset=utf-8"
      },
      body
    });
    this.expectStatus(response, [207]);
    return parseMultiStatus(await response.text());
  }
  async request(url, init) {
    const target = this.resolveHref(url);
    try {
      return await this.fetchImplementation(target, {
        ...init,
        headers: {
          Accept: "application/xml, text/calendar",
          Authorization: this.authorization,
          ...init.headers
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
        redirect: "manual"
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new CalDavError(
          "REQUEST_TIMEOUT",
          "CalDAV request timed out.",
          void 0,
          { cause: error }
        );
      }
      throw new CalDavError(
        "CALDAV_UNAVAILABLE",
        "CalDAV server could not be reached.",
        void 0,
        {
          cause: error
        }
      );
    }
  }
  resolveHref(href) {
    const resolved = new URL(href, this.baseUrl);
    if (resolved.origin !== this.baseUrl.origin) {
      this.protocolError("CalDAV server returned a cross-origin resource URL.");
    }
    return resolved;
  }
  expectStatus(response, expected) {
    if (expected.includes(response.status)) return;
    if (response.status === 401)
      throw new CalDavError(
        "AUTHENTICATION_FAILED",
        "CalDAV server rejected the configured credentials.",
        401
      );
    if (response.status === 403)
      throw new CalDavError(
        "FORBIDDEN",
        "CalDAV server denied access to the requested resource.",
        403
      );
    if (response.status === 404)
      throw new CalDavError(
        "NOT_FOUND",
        "The requested CalDAV resource was not found.",
        404
      );
    if (response.status === 409 || response.status === 412)
      throw new CalDavError(
        "VERSION_CONFLICT",
        "The CalDAV resource was modified remotely.",
        response.status
      );
    throw new CalDavError(
      "CALDAV_PROTOCOL_ERROR",
      `CalDAV server returned unexpected HTTP status ${response.status}.`,
      response.status
    );
  }
  firstProperties(sets, requiredProperty) {
    const properties = sets.find(
      (set) => Object.hasOwn(set.properties, requiredProperty)
    )?.properties;
    if (!properties)
      this.protocolError(`CalDAV response omitted ${requiredProperty}.`);
    return properties;
  }
  protocolError(message) {
    throw new CalDavError("CALDAV_PROTOCOL_ERROR", message);
  }
  assertRange(start, end) {
    const duration = end.getTime() - start.getTime();
    if (!Number.isFinite(duration) || duration <= 0 || duration > 366 * 24 * 60 * 60 * 1e3) {
      throw new CalDavError(
        "CALDAV_PROTOCOL_ERROR",
        "Calendar query range must be positive and no longer than 366 days."
      );
    }
  }
  dateTime(date) {
    return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
  }
  xml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
  }
};

// src/errors.ts
var ApiError = class extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = "ApiError";
  }
  status;
  code;
  details;
};
function notFoundHandler() {
  return (request, _response, next) => {
    next(
      new ApiError(
        404,
        "NOT_FOUND",
        `No endpoint matches ${request.method} ${request.path}.`
      )
    );
  };
}
function errorHandler(logger2) {
  return (error, _request, response, next) => {
    void next;
    const requestId = String(response.locals.requestId ?? "unknown");
    const apiError = error instanceof ApiError ? error : new ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    if (apiError.status >= 500)
      logger2.error({ err: error, requestId }, apiError.message);
    else logger2.warn({ code: apiError.code, requestId }, apiError.message);
    response.status(apiError.status).json({
      error: {
        code: apiError.code,
        message: apiError.message,
        ...apiError.details ? { details: apiError.details } : {},
        requestId
      }
    });
  };
}

// src/auth.ts
var cookieName = "dayfront_session";
var tokenVersion = "v1";
var contexts = /* @__PURE__ */ new WeakMap();
function cookies(header) {
  return new Map(
    (header ?? "").split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 1) return [];
      return [[part.slice(0, separator).trim(), part.slice(separator + 1)]];
    })
  );
}
function key(secret) {
  return createHash2("sha256").update(secret, "utf8").digest();
}
function seal(payload, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(`dayfront-session:${tokenVersion}`));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  return [
    tokenVersion,
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url")
  ].join(".");
}
function unseal(token, secret, now = Date.now()) {
  try {
    const [version, ivValue, encryptedValue, tagValue, extra] = token.split(".");
    if (version !== tokenVersion || !ivValue || !encryptedValue || !tagValue || extra)
      return void 0;
    const iv = Buffer.from(ivValue, "base64url");
    const encrypted = Buffer.from(encryptedValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    if (iv.toString("base64url") !== ivValue || encrypted.toString("base64url") !== encryptedValue || tag.toString("base64url") !== tagValue || iv.length !== 12 || tag.length !== 16)
      return void 0;
    const decipher = createDecipheriv("aes-256-gcm", key(secret), iv);
    decipher.setAAD(Buffer.from(`dayfront-session:${tokenVersion}`));
    decipher.setAuthTag(tag);
    const value = JSON.parse(
      Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
        "utf8"
      )
    );
    if (typeof value !== "object" || value === null || !("username" in value) || typeof value.username !== "string" || !("password" in value) || typeof value.password !== "string" || !("issuedAt" in value) || typeof value.issuedAt !== "number" || !("expiresAt" in value) || typeof value.expiresAt !== "number" || value.expiresAt <= now || value.issuedAt > now + 6e4)
      return void 0;
    return value;
  } catch {
    return void 0;
  }
}
function cookie(value, maxAge, secure) {
  return [
    `${cookieName}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    ...secure ? ["Secure"] : [],
    `Max-Age=${Math.max(0, Math.floor(maxAge / 1e3))}`
  ].join("; ");
}
function sameOrigin(request) {
  const origin = request.header("origin");
  if (!origin) return true;
  try {
    const expectedProtocol = request.protocol;
    const expectedHost = request.get("host");
    const parsed = new URL(origin);
    return parsed.protocol === `${expectedProtocol}:` && parsed.host === expectedHost;
  } catch {
    return false;
  }
}
function createAuthentication(config2, options = {}) {
  const ipAttempts = /* @__PURE__ */ new Map();
  const identityAttempts = /* @__PURE__ */ new Map();
  const now = options.now ?? Date.now;
  const multiUser = config2.authentication.mode === "caldav-login";
  const secret = config2.authentication.sessionSecret;
  const ttlMs = config2.authentication.sessionTtlHours * 36e5;
  const attemptWindowMs = 15 * 6e4;
  function activeAttempts(buckets, attemptKey, currentTime) {
    const bucket = buckets.get(attemptKey);
    if (!bucket || bucket.resetAt <= currentTime) {
      if (bucket) buckets.delete(attemptKey);
      return 0;
    }
    return bucket.attempts;
  }
  function recordFailure(buckets, attemptKey, currentTime) {
    const current = activeAttempts(buckets, attemptKey, currentTime);
    buckets.set(attemptKey, {
      attempts: current + 1,
      resetAt: currentTime + attemptWindowMs
    });
    if (buckets.size <= 1e4) return;
    for (const [key2, value] of buckets)
      if (value.resetAt <= currentTime) buckets.delete(key2);
    if (buckets.size > 1e4) {
      const oldest = buckets.keys().next().value;
      if (typeof oldest === "string") buckets.delete(oldest);
    }
  }
  function rateLimited(response, next) {
    response.setHeader("Retry-After", String(attemptWindowMs / 1e3));
    next(
      new ApiError(
        429,
        "RATE_LIMITED",
        "Too many sign-in attempts. Try again later."
      )
    );
  }
  const session = (request, _response, next) => {
    if (!multiUser) {
      contexts.set(request, {
        username: config2.caldav.username,
        password: config2.caldav.password
      });
      next();
      return;
    }
    const token = cookies(request.header("cookie")).get(cookieName);
    const payload = token && secret ? unseal(token, secret, now()) : void 0;
    if (payload)
      contexts.set(request, {
        username: payload.username,
        password: payload.password
      });
    next();
  };
  const requireSession = (request, _response, next) => {
    if (!contexts.has(request)) {
      next(
        new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.")
      );
      return;
    }
    next();
  };
  const requireSameOrigin = (request, _response, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      next();
      return;
    }
    if (multiUser && !sameOrigin(request)) {
      next(
        new ApiError(
          403,
          "ORIGIN_REJECTED",
          "The request origin was rejected."
        )
      );
      return;
    }
    next();
  };
  const login = async (request, response, next) => {
    if (!multiUser) {
      next(new ApiError(404, "NOT_FOUND", "Login is not enabled."));
      return;
    }
    const currentTime = now();
    const ipKey = request.ip ?? "unknown";
    if (activeAttempts(ipAttempts, ipKey, currentTime) >= 30) {
      rateLimited(response, next);
      return;
    }
    const body = request.body;
    const username = typeof body === "object" && body !== null && "username" in body && typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body === "object" && body !== null && "password" in body && typeof body.password === "string" ? body.password : "";
    if (!username || username.length > 256 || !password || password.length > 2048) {
      recordFailure(ipAttempts, ipKey, currentTime);
      next(
        new ApiError(
          401,
          "INVALID_CREDENTIALS",
          "Invalid username or password."
        )
      );
      return;
    }
    const attemptKey = `${ipKey}:${username.toLocaleLowerCase("en-US")}`;
    if (activeAttempts(identityAttempts, attemptKey, currentTime) >= 10) {
      rateLimited(response, next);
      return;
    }
    try {
      await new CalDavClient(
        { ...config2.caldav, username, password },
        options.fetch ? { fetch: options.fetch } : {}
      ).discover();
      identityAttempts.delete(attemptKey);
      const payload = {
        username,
        password,
        issuedAt: currentTime,
        expiresAt: currentTime + ttlMs
      };
      response.setHeader(
        "Set-Cookie",
        cookie(seal(payload, secret), ttlMs, request.secure)
      );
      response.setHeader("Cache-Control", "no-store");
      response.json({
        data: { authenticated: true, username },
        meta: { requestId: String(response.locals.requestId) }
      });
    } catch (error) {
      if (error instanceof CalDavError && ["AUTHENTICATION_FAILED", "FORBIDDEN"].includes(error.code)) {
        recordFailure(ipAttempts, ipKey, currentTime);
        recordFailure(identityAttempts, attemptKey, currentTime);
        next(
          new ApiError(
            401,
            "INVALID_CREDENTIALS",
            "Invalid username or password."
          )
        );
        return;
      }
      next(
        new ApiError(
          503,
          "CALDAV_UNAVAILABLE",
          "The CalDAV server could not verify the login."
        )
      );
    }
  };
  const logout = (request, response) => {
    response.setHeader("Set-Cookie", cookie("", 0, request.secure));
    response.setHeader("Cache-Control", "no-store");
    response.status(204).send();
  };
  const status = (request, response) => {
    const context = contexts.get(request);
    response.setHeader("Cache-Control", "no-store");
    response.json({
      data: {
        mode: config2.authentication.mode,
        authenticated: Boolean(context),
        ...multiUser && context ? { username: context.username } : {}
      },
      meta: { requestId: String(response.locals.requestId) }
    });
  };
  return {
    session,
    requireSession,
    requireSameOrigin,
    login,
    logout,
    status,
    client(request) {
      const context = contexts.get(request);
      if (!context)
        throw new ApiError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Sign in to continue."
        );
      return new CalDavClient(
        { ...config2.caldav, ...context },
        options.fetch ? { fetch: options.fetch } : {}
      );
    }
  };
}

// src/config.ts
import { readFileSync, writeFileSync } from "fs";
import { randomBytes as randomBytes2 } from "crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
var strictObject = (shape) => z.object(shape).strict();
var subscriptionSchema = strictObject({
  id: z.string().regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,
    "Must be a stable identifier using letters, numbers, _ or -."
  ),
  name: z.string().trim().min(1).max(200),
  url: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Must use HTTP or HTTPS."
  }),
  enabled: z.boolean().default(true),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a six-digit hex color.").optional(),
  refreshIntervalMs: z.number().int().min(6e4).max(31536e6)
});
var configSchema = strictObject({
  caldav: strictObject({
    url: z.url().refine(
      (value) => ["http:", "https:"].includes(new URL(value).protocol),
      {
        message: "Must use HTTP or HTTPS."
      }
    ),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(12e4)
  }),
  authentication: strictObject({
    mode: z.enum(["single-user", "caldav-login"]),
    sessionSecret: z.string().min(32).optional(),
    sessionSecretFile: z.string().min(1).optional(),
    sessionTtlHours: z.number().int().min(1).max(8760)
  }),
  server: strictObject({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    trustProxy: z.boolean()
  }),
  ui: strictObject({
    defaultView: z.enum(["month", "week", "day", "agenda"]),
    darkMode: z.enum(["auto", "light", "dark"]),
    timeFormat: z.enum(["12h", "24h"]),
    defaultCalendar: z.string().min(1).optional(),
    sidebar: strictObject({
      enabled: z.boolean(),
      defaultOpen: z.boolean(),
      showBrand: z.boolean(),
      showTasks: z.boolean(),
      showCalendars: z.boolean()
    })
  }),
  calendar: strictObject({
    timezone: z.string().min(1),
    weekStartsOn: z.union([
      z.literal("locale"),
      z.number().int().min(0).max(6)
    ]),
    maxOccurrences: z.number().int().positive().max(1e5)
  }),
  logging: strictObject({
    level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]),
    format: z.enum(["json", "pretty"])
  }),
  calendarSubscriptions: z.array(subscriptionSchema)
}).superRefine((config2, context) => {
  if (config2.authentication.mode === "single-user") {
    if (!config2.caldav.username)
      context.addIssue({
        code: "custom",
        path: ["caldav", "username"],
        message: "Required in single-user authentication mode."
      });
    if (!config2.caldav.password)
      context.addIssue({
        code: "custom",
        path: ["caldav", "password"],
        message: "Required in single-user authentication mode."
      });
  }
  if (config2.authentication.mode === "caldav-login" && !config2.authentication.sessionSecret)
    context.addIssue({
      code: "custom",
      path: ["authentication", "sessionSecret"],
      message: "Required in caldav-login mode and must contain at least 32 characters."
    });
});
var defaults = {
  caldav: { timeoutMs: 1e4 },
  authentication: { mode: "single-user", sessionTtlHours: 24 * 30 },
  server: { host: "0.0.0.0", port: 8080, trustProxy: false },
  ui: {
    defaultView: "month",
    darkMode: "auto",
    timeFormat: "12h",
    sidebar: {
      enabled: true,
      defaultOpen: false,
      showBrand: true,
      showTasks: true,
      showCalendars: true
    }
  },
  calendar: {
    timezone: "local",
    weekStartsOn: "locale",
    maxOccurrences: 5e3
  },
  logging: { level: "info", format: "json" },
  calendarSubscriptions: []
};
var configurationWarnings = /* @__PURE__ */ new WeakMap();
function parseDuration(value) {
  if (value === void 0) return 24 * 60 * 60 * 1e3;
  if (typeof value !== "string") return void 0;
  const match = /^(\d+)(m|h|d)$/.exec(value.trim());
  if (!match) return void 0;
  const amount = Number(match[1]);
  const multiplier = { m: 6e4, h: 36e5, d: 864e5 }[match[2]];
  const result = amount * multiplier;
  return Number.isSafeInteger(result) && result >= 6e4 && result <= 31536e6 ? result : void 0;
}
function subscriptions(value) {
  if (value === void 0) return { data: [], warnings: [] };
  if (!Array.isArray(value))
    return {
      data: [],
      warnings: [
        "calendar_subscriptions must be a list; all subscriptions were ignored."
      ]
    };
  const counts = /* @__PURE__ */ new Map();
  for (const item of value)
    if (isRecord(item) && typeof item.id === "string")
      counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  const data = [];
  const warnings = [];
  value.forEach((item, index) => {
    if (isRecord(item) && typeof item.id === "string" && (counts.get(item.id) ?? 0) > 1) {
      warnings.push(
        `calendar_subscriptions[${index}] has duplicate id "${item.id}" and was ignored.`
      );
      return;
    }
    const refreshIntervalMs = isRecord(item) ? parseDuration(item.refresh_interval) : void 0;
    const normalized = isRecord(item) ? { ...item, refreshIntervalMs, enabled: item.enabled ?? true } : item;
    if (isRecord(normalized)) delete normalized.refresh_interval;
    const result = subscriptionSchema.safeParse(normalized);
    if (result.success) data.push(result.data);
    else
      warnings.push(
        `calendar_subscriptions[${index}] was ignored: ${result.error.issues.map((issue) => `${issue.path.join(".") || "entry"} ${issue.message}`).join("; ")}`
      );
  });
  return { data, warnings };
}
var envPaths = {
  DAYFRONT_CALDAV_URL: ["caldav", "url"],
  DAYFRONT_CALDAV_USERNAME: ["caldav", "username"],
  DAYFRONT_CALDAV_PASSWORD: ["caldav", "password"],
  DAYFRONT_CALDAV_TIMEOUT_MS: ["caldav", "timeoutMs"],
  DAYFRONT_AUTH_MODE: ["authentication", "mode"],
  DAYFRONT_AUTH_SESSION_SECRET: ["authentication", "sessionSecret"],
  DAYFRONT_AUTH_SESSION_SECRET_FILE: ["authentication", "sessionSecretFile"],
  DAYFRONT_AUTH_SESSION_TTL_HOURS: ["authentication", "sessionTtlHours"],
  DAYFRONT_SERVER_HOST: ["server", "host"],
  DAYFRONT_SERVER_PORT: ["server", "port"],
  DAYFRONT_SERVER_TRUST_PROXY: ["server", "trustProxy"],
  DAYFRONT_UI_DEFAULT_VIEW: ["ui", "defaultView"],
  DAYFRONT_UI_DARK_MODE: ["ui", "darkMode"],
  DAYFRONT_UI_TIME_FORMAT: ["ui", "timeFormat"],
  DAYFRONT_UI_DEFAULT_CALENDAR: ["ui", "defaultCalendar"],
  DAYFRONT_UI_SIDEBAR_ENABLED: ["ui", "sidebar", "enabled"],
  DAYFRONT_UI_SIDEBAR_DEFAULT_OPEN: ["ui", "sidebar", "defaultOpen"],
  DAYFRONT_UI_SIDEBAR_SHOW_BRAND: ["ui", "sidebar", "showBrand"],
  DAYFRONT_UI_SIDEBAR_SHOW_TASKS: ["ui", "sidebar", "showTasks"],
  DAYFRONT_UI_SIDEBAR_SHOW_CALENDARS: ["ui", "sidebar", "showCalendars"],
  DAYFRONT_CALENDAR_TIMEZONE: ["calendar", "timezone"],
  DAYFRONT_CALENDAR_WEEK_STARTS_ON: ["calendar", "weekStartsOn"],
  DAYFRONT_CALENDAR_MAX_OCCURRENCES: ["calendar", "maxOccurrences"],
  DAYFRONT_LOG_LEVEL: ["logging", "level"],
  DAYFRONT_LOG_FORMAT: ["logging", "format"]
};
var numericVariables = /* @__PURE__ */ new Set([
  "DAYFRONT_CALDAV_TIMEOUT_MS",
  "DAYFRONT_AUTH_SESSION_TTL_HOURS",
  "DAYFRONT_SERVER_PORT",
  "DAYFRONT_CALENDAR_MAX_OCCURRENCES"
]);
var ConfigurationError = class extends Error {
  constructor(problems) {
    super(
      `Invalid DayFront configuration:
${problems.map((problem) => `- ${problem}`).join("\n")}`
    );
    this.problems = problems;
    this.name = "ConfigurationError";
  }
  problems;
};
function merge(base, override) {
  const result = { ...base };
  for (const [key2, value] of Object.entries(override)) {
    const current = result[key2];
    result[key2] = isRecord(current) && isRecord(value) ? merge(current, value) : value;
  }
  return result;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseEnvironment(name, value) {
  if (numericVariables.has(name)) return Number(value);
  if (name === "DAYFRONT_SERVER_TRUST_PROXY" || name.startsWith("DAYFRONT_UI_SIDEBAR_")) {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }
  if (name === "DAYFRONT_CALENDAR_WEEK_STARTS_ON" && value !== "locale") {
    return Number(value);
  }
  return value;
}
function environmentConfig(environment) {
  const result = {};
  for (const [name, path] of Object.entries(envPaths)) {
    const value = environment[name];
    if (value === void 0) continue;
    let section = result;
    for (const key2 of path.slice(0, -1))
      section = section[key2] ??= {};
    section[path.at(-1)] = parseEnvironment(name, value);
  }
  return result;
}
function readYaml(path, required) {
  try {
    const parsed = parseYaml(readFileSync(path, "utf8"));
    if (parsed === null || parsed === void 0) return {};
    if (!isRecord(parsed))
      throw new ConfigurationError(["Configuration root must be an object."]);
    return parsed;
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    if (isMissingFile(error) && !required) return {};
    if (isMissingFile(error))
      throw new ConfigurationError([`Configuration file not found: ${path}`]);
    throw new ConfigurationError([
      `Could not parse configuration file: ${path}`
    ]);
  }
}
function isMissingFile(error) {
  return isRecord(error) && error.code === "ENOENT";
}
function loadConfig(options = {}) {
  const environment = options.environment ?? process.env;
  const explicitPath = options.configFile ?? environment.DAYFRONT_CONFIG_FILE;
  const path = explicitPath ?? "/config/config.yaml";
  const yaml = readYaml(path, explicitPath !== void 0);
  const parsedSubscriptions = subscriptions(yaml.calendar_subscriptions);
  delete yaml.calendar_subscriptions;
  const candidate = merge(
    merge(defaults, yaml),
    environmentConfig(environment)
  );
  const authentication = candidate.authentication;
  if (isRecord(authentication) && authentication.mode === "caldav-login" && authentication.sessionSecret === void 0 && typeof authentication.sessionSecretFile === "string") {
    authentication.sessionSecret = sessionSecret(
      authentication.sessionSecretFile
    );
  }
  candidate.calendarSubscriptions = parsedSubscriptions.data;
  const result = configSchema.safeParse(candidate);
  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".") || "config"}: ${issue.message}`
      )
    );
  }
  configurationWarnings.set(result.data, parsedSubscriptions.warnings);
  return result.data;
}
function sessionSecret(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch (error) {
    if (!isMissingFile(error))
      throw new ConfigurationError([
        `Could not read authentication session secret file: ${path}`
      ]);
  }
  const generated = randomBytes2(48).toString("base64url");
  try {
    writeFileSync(path, `${generated}
`, {
      encoding: "utf8",
      mode: 384,
      flag: "wx"
    });
    return generated;
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST") {
      try {
        return readFileSync(path, "utf8").trim();
      } catch {
      }
    }
    throw new ConfigurationError([
      `Could not create authentication session secret file: ${path}`
    ]);
  }
}
function getConfigurationWarnings(config2) {
  return configurationWarnings.get(config2) ?? [];
}
function getPublicConfig(config2) {
  return {
    ui: config2.ui,
    calendar: config2.calendar,
    authentication: { mode: config2.authentication.mode }
  };
}

// ../../packages/shared/src/health.ts
import { z as z2 } from "zod";
var healthResponseSchema = z2.object({
  data: z2.object({
    status: z2.literal("ok"),
    service: z2.literal("dayfront-api")
  }),
  meta: z2.object({
    requestId: z2.string().min(1)
  })
});
var readinessResponseSchema = z2.object({
  data: z2.object({
    status: z2.enum(["ready", "not-ready"]),
    checks: z2.object({
      configuration: z2.enum(["pending", "ok", "failed"]),
      caldav: z2.enum(["pending", "ok", "failed"])
    })
  }),
  meta: z2.object({
    requestId: z2.string().min(1)
  })
});

// ../../packages/shared/src/calendar.ts
import { z as z3 } from "zod";
var calendarSchema = z3.object({
  id: z3.string().min(1),
  displayName: z3.string().min(1),
  description: z3.string().optional(),
  color: z3.string().optional(),
  components: z3.array(z3.enum(["VEVENT", "VTODO", "VJOURNAL"])),
  readOnly: z3.boolean().optional()
});
var calendarMutationSchema = z3.object({
  name: z3.string().trim().min(1).max(200),
  description: z3.string().max(2e3).optional(),
  color: z3.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  components: z3.array(z3.enum(["VEVENT", "VTODO"])).min(1).default(["VEVENT", "VTODO"])
});
var calendarEventSchema = z3.object({
  id: z3.string().min(1),
  resourceId: z3.string().min(1),
  calendarId: z3.string().min(1),
  uid: z3.string().min(1),
  title: z3.string(),
  start: z3.string(),
  end: z3.string().optional(),
  allDay: z3.boolean(),
  description: z3.string().optional(),
  location: z3.string().optional(),
  category: z3.enum(["fixed", "urgent", "fun", "routine", "default"]).optional(),
  color: z3.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  version: z3.string().min(1),
  entryType: z3.enum(["event", "note", "todo"]).default("event"),
  recurring: z3.boolean(),
  recurrenceId: z3.string().optional(),
  recurrenceRule: z3.string().optional(),
  readOnly: z3.boolean().optional()
});
var eventMutationSchema = z3.object({
  calendarId: z3.string().min(1),
  title: z3.string().trim().min(1).max(500),
  start: z3.string().min(1),
  end: z3.string().optional(),
  allDay: z3.boolean(),
  description: z3.string().max(1e5).optional(),
  location: z3.string().max(2e3).optional(),
  category: z3.enum(["fixed", "urgent", "fun", "routine", "default"]).optional(),
  color: z3.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  recurrenceRule: z3.string().max(2e3).nullable().optional(),
  recurrenceScope: z3.enum(["series", "occurrence"]).optional(),
  recurrenceId: z3.string().optional(),
  occurrenceStart: z3.string().optional()
}).superRefine((value, context) => {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const valid = (date) => value.allDay ? dateOnly.test(date) : Number.isFinite(new Date(date).getTime());
  if (!valid(value.start)) {
    context.addIssue({
      code: "custom",
      path: ["start"],
      message: "Start is invalid."
    });
  }
  if (value.end && !valid(value.end)) {
    context.addIssue({
      code: "custom",
      path: ["end"],
      message: "End is invalid."
    });
  }
  if (value.end && valid(value.start) && valid(value.end) && new Date(value.start).getTime() >= new Date(value.end).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["end"],
      message: "Start must be before end."
    });
  }
  if (value.recurrenceScope === "occurrence" && !value.recurrenceId) {
    context.addIssue({
      code: "custom",
      path: ["recurrenceId"],
      message: "The occurrence identifier is required."
    });
  }
});
var taskStatusSchema = z3.enum([
  "needs-action",
  "in-process",
  "completed",
  "cancelled"
]);
var calendarTaskSchema = z3.object({
  id: z3.string().min(1),
  resourceId: z3.string().min(1),
  calendarId: z3.string().min(1),
  uid: z3.string().min(1),
  title: z3.string(),
  start: z3.string().optional(),
  due: z3.string().optional(),
  allDay: z3.boolean(),
  description: z3.string().optional(),
  status: taskStatusSchema,
  completed: z3.boolean(),
  completedAt: z3.string().optional(),
  priority: z3.number().int().min(0).max(9),
  category: z3.enum(["fixed", "urgent", "fun", "routine", "default"]).optional(),
  color: z3.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  startTaskUid: z3.string().min(1).optional(),
  startGate: z3.boolean().optional(),
  version: z3.string().min(1),
  entryType: z3.literal("todo").default("todo"),
  recurring: z3.boolean(),
  recurrenceRule: z3.string().optional(),
  recurrenceId: z3.string().optional(),
  parentUid: z3.string().min(1).optional(),
  childUids: z3.array(z3.string().min(1)).optional()
});
var taskMutationSchema = z3.object({
  calendarId: z3.string().min(1),
  title: z3.string().trim().min(1).max(500),
  start: z3.string().optional(),
  due: z3.string().optional(),
  allDay: z3.boolean(),
  description: z3.string().max(1e5).optional(),
  status: taskStatusSchema.default("needs-action"),
  priority: z3.number().int().min(0).max(9).default(0),
  category: z3.enum(["fixed", "urgent", "fun", "routine", "default"]).optional(),
  color: z3.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  startTaskUid: z3.string().min(1).nullable().optional(),
  startGate: z3.boolean().optional(),
  recurrenceRule: z3.string().max(2e3).nullable().optional(),
  recurrenceId: z3.string().optional(),
  occurrenceStart: z3.string().optional(),
  recurrenceScope: z3.enum(["series", "occurrence"]).optional(),
  parentUid: z3.string().min(1).nullable().optional()
}).superRefine((value, context) => {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  for (const field of ["start", "due"]) {
    const item = value[field];
    if (item && (value.allDay ? !dateOnly.test(item) : !Number.isFinite(new Date(item).getTime()))) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} is invalid.`
      });
    }
  }
  if (value.start && value.due && new Date(value.start).getTime() > new Date(value.due).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["due"],
      message: "Due must not be before start."
    });
  }
  if (typeof value.recurrenceRule === "string" && !value.start && !value.due) {
    context.addIssue({
      code: "custom",
      path: ["start"],
      message: "Recurring tasks require a start or due date."
    });
  }
});
var responseMetaSchema = z3.object({
  requestId: z3.string().min(1),
  warnings: z3.array(z3.string()).optional()
});
var calendarTasksResponseSchema = z3.object({
  data: z3.array(calendarTaskSchema),
  meta: responseMetaSchema
});
var calendarTaskResponseSchema = z3.object({
  data: calendarTaskSchema,
  meta: z3.object({ requestId: z3.string().min(1) })
});
var calendarEventResponseSchema = z3.object({
  data: calendarEventSchema,
  meta: z3.object({ requestId: z3.string().min(1) })
});
var publicConfigSchema = z3.object({
  data: z3.object({
    authentication: z3.object({ mode: z3.enum(["single-user", "caldav-login"]) }).default({ mode: "single-user" }),
    ui: z3.object({
      defaultView: z3.enum(["month", "week", "day", "agenda"]),
      darkMode: z3.enum(["auto", "light", "dark"]),
      timeFormat: z3.enum(["12h", "24h"]).default("12h"),
      defaultCalendar: z3.string().optional(),
      sidebar: z3.object({
        enabled: z3.boolean(),
        defaultOpen: z3.boolean().default(false),
        showBrand: z3.boolean(),
        showTasks: z3.boolean(),
        showCalendars: z3.boolean()
      }).default({
        enabled: true,
        defaultOpen: false,
        showBrand: true,
        showTasks: true,
        showCalendars: true
      })
    }),
    calendar: z3.object({
      timezone: z3.string(),
      weekStartsOn: z3.union([
        z3.literal("locale"),
        z3.number().int().min(0).max(6)
      ]),
      maxOccurrences: z3.number().int().positive()
    })
  }),
  meta: z3.object({ requestId: z3.string().min(1) })
});
var calendarsResponseSchema = z3.object({
  data: z3.array(calendarSchema),
  meta: responseMetaSchema
});
var calendarResponseSchema = z3.object({
  data: calendarSchema,
  meta: z3.object({ requestId: z3.string().min(1) })
});
var calendarEventsResponseSchema = z3.object({
  data: z3.array(calendarEventSchema),
  meta: responseMetaSchema
});

// src/calendar/routes.ts
import { AsyncLocalStorage } from "async_hooks";
import { Router } from "express";
import { randomUUID as randomUUID3 } from "crypto";

// src/calendar/event-editor.ts
import { randomUUID } from "crypto";
import ICAL from "ical.js";
function time(value, allDay) {
  if (allDay) return ICAL.Time.fromDateString(value.slice(0, 10));
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CalDavError(
      "CALDAV_PROTOCOL_ERROR",
      "Event contains an invalid date-time."
    );
  }
  return ICAL.Time.fromJSDate(date, true);
}
var weekDays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
function utcNow() {
  return ICAL.Time.fromJSDate(/* @__PURE__ */ new Date(), true);
}
function recurrenceRule(input) {
  if (typeof input.recurrenceRule !== "string") return void 0;
  const rule = input.recurrenceRule.toUpperCase();
  if (!input.allDay || !/(^|;)FREQ=WEEKLY(;|$)/.test(rule) || /(^|;)BYDAY=/.test(rule))
    return input.recurrenceRule;
  const date = /* @__PURE__ */ new Date(`${input.start.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return input.recurrenceRule;
  return `${input.recurrenceRule};BYDAY=${weekDays[date.getUTCDay()]}`;
}
function apply(event, input) {
  event.summary = input.title;
  event.startDate = time(input.start, input.allDay);
  if (input.end) event.endDate = time(input.end, input.allDay);
  else event.component.removeProperty("dtend");
  if (input.description) event.description = input.description;
  else event.component.removeProperty("description");
  if (input.location) event.location = input.location;
  else event.component.removeProperty("location");
  if (typeof input.recurrenceRule === "string") {
    try {
      event.component.updatePropertyWithValue(
        "rrule",
        ICAL.Recur.fromString(recurrenceRule(input) ?? input.recurrenceRule)
      );
    } catch (error) {
      throw new CalDavError(
        "CALDAV_PROTOCOL_ERROR",
        "The recurrence rule is invalid.",
        void 0,
        { cause: error }
      );
    }
  } else if (input.recurrenceRule === null) {
    event.component.removeAllProperties("rrule");
  }
  if (input.category !== void 0) event.component.updatePropertyWithValue("x-leo-category", input.category);
  if (input.color !== void 0) event.component.updatePropertyWithValue("x-leo-color", input.color);
  if (!event.component.hasProperty("status"))
    event.component.updatePropertyWithValue("status", "CONFIRMED");
  event.component.updatePropertyWithValue("dtstamp", utcNow());
}
function parsedCalendar(source) {
  return new ICAL.Component(ICAL.parse(source));
}
function masterEvent(calendar) {
  const component = calendar.getAllSubcomponents("vevent").find((item) => !item.hasProperty("recurrence-id"));
  if (!component) throw new Error("Master VEVENT was not found.");
  return new ICAL.Event(component);
}
function recurrenceTime(value) {
  try {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? ICAL.Time.fromDateString(value) : ICAL.Time.fromDateTimeString(value);
  } catch (error) {
    throw new CalDavError(
      "CALDAV_PROTOCOL_ERROR",
      "The recurrence identifier is invalid.",
      void 0,
      { cause: error }
    );
  }
}
function removeRecurrence(component) {
  for (const name of ["rrule", "rdate", "exdate"])
    component.removeAllProperties(name);
}
function occurrenceEvent(calendar, master, id) {
  const existing = calendar.getAllSubcomponents("vevent").find(
    (component2) => component2.getFirstPropertyValue("recurrence-id")?.toString() === id.toString()
  );
  if (existing) return new ICAL.Event(existing);
  const component = ICAL.Component.fromString(master.component.toString());
  removeRecurrence(component);
  component.updatePropertyWithValue("recurrence-id", id);
  calendar.addSubcomponent(component);
  return new ICAL.Event(component);
}
function seriesInput(master, input) {
  if (!input.occurrenceStart) return input;
  const submittedStart = new Date(input.start).getTime();
  const openedStart = new Date(input.occurrenceStart).getTime();
  const masterStart = master.startDate.toJSDate().getTime();
  if (![submittedStart, openedStart, masterStart].every(Number.isFinite))
    return input;
  const shiftedStart = masterStart + submittedStart - openedStart;
  const duration = input.end ? new Date(input.end).getTime() - submittedStart : void 0;
  const dateValue2 = (milliseconds) => input.allDay ? new Date(milliseconds).toISOString().slice(0, 10) : new Date(milliseconds).toISOString();
  return {
    ...input,
    start: dateValue2(shiftedStart),
    ...duration === void 0 ? { end: void 0 } : { end: dateValue2(shiftedStart + duration) }
  };
}
function createEventData(input) {
  const calendar = new ICAL.Component("vcalendar");
  calendar.updatePropertyWithValue("version", "2.0");
  calendar.updatePropertyWithValue("prodid", "-//DayFront//CalDAV Client//EN");
  const component = new ICAL.Component("vevent");
  calendar.addSubcomponent(component);
  const event = new ICAL.Event(component);
  event.uid = randomUUID();
  apply(event, input);
  return calendar.toString();
}
function updateEventData(source, input) {
  try {
    const calendar = parsedCalendar(source);
    const master = masterEvent(calendar);
    if (input.recurrenceScope === "occurrence" && input.recurrenceId) {
      const id = recurrenceTime(input.recurrenceId);
      const exception = occurrenceEvent(calendar, master, id);
      apply(exception, { ...input, recurrenceRule: null });
      exception.component.updatePropertyWithValue("recurrence-id", id);
    } else {
      apply(master, seriesInput(master, input));
    }
    return calendar.toString();
  } catch (error) {
    if (error instanceof CalDavError) throw error;
    throw new CalDavError(
      "CALDAV_PROTOCOL_ERROR",
      "The event resource could not be edited.",
      void 0,
      { cause: error }
    );
  }
}
function deleteOccurrenceData(source, recurrenceId) {
  try {
    const calendar = parsedCalendar(source);
    const master = masterEvent(calendar);
    const id = recurrenceTime(recurrenceId);
    for (const component of calendar.getAllSubcomponents("vevent")) {
      if (component.getFirstPropertyValue("recurrence-id")?.toString() === id.toString()) {
        calendar.removeSubcomponent(component);
      }
    }
    master.component.addPropertyWithValue("exdate", id);
    master.component.updatePropertyWithValue("dtstamp", utcNow());
    return calendar.toString();
  } catch (error) {
    if (error instanceof CalDavError) throw error;
    throw new CalDavError(
      "CALDAV_PROTOCOL_ERROR",
      "The recurring occurrence could not be deleted.",
      void 0,
      { cause: error }
    );
  }
}

// src/calendar/event-mapper.ts
import { createHash as createHash3 } from "crypto";
import ICAL2 from "ical.js";
function dateValue(time2) {
  return time2.isDate ? time2.toString().slice(0, 10) : time2.toJSDate().toISOString();
}
function recurrenceRule2(event) {
  const property = event.component.getFirstProperty("rrule");
  if (!property) return void 0;
  const value = property.getFirstValue();
  return value instanceof ICAL2.Recur ? value.toString() : void 0;
}
function intersects(start, end, range) {
  return start.toJSDate() < range.end && end.toJSDate() > range.start;
}
function isCancelled(event) {
  const status = event.component.getFirstPropertyValue("status");
  return typeof status === "string" && status.toUpperCase() === "CANCELLED";
}
function mappedEvent(resource, calendarId, event, start, end, recurrenceId, seriesEvent = event) {
  const resourceId = Buffer.from(resource.url).toString("base64url");
  const identity = recurrenceId?.toString() ?? start.toString();
  const id = createHash3("sha256").update(`${resource.url}\0${event.uid}\0${identity}`).digest("base64url").slice(0, 30);
  const rule = recurrenceRule2(seriesEvent);
  const category = event.component.getFirstPropertyValue("x-leo-category") ?? seriesEvent.component.getFirstPropertyValue("x-leo-category");
  const color = event.component.getFirstPropertyValue("x-leo-color") ?? seriesEvent.component.getFirstPropertyValue("x-leo-color");
  return {
    id,
    resourceId,
    calendarId,
    uid: event.uid,
    title: event.summary || "(untitled)",
    start: dateValue(start),
    end: dateValue(end),
    allDay: start.isDate,
    ...event.description ? { description: event.description } : {},
    ...event.location ? { location: event.location } : {},
    ...category ? { category } : {},
    ...color ? { color } : {},
    version: resource.etag,
    entryType: "event",
    recurring: seriesEvent.isRecurring() || event.isRecurrenceException(),
    readOnly: false,
    ...recurrenceId ? { recurrenceId: recurrenceId.toString() } : {},
    ...rule ? { recurrenceRule: rule } : {}
  };
}
function mapCalendarResource(resource, calendarId, range) {
  try {
    const calendar = new ICAL2.Component(ICAL2.parse(resource.calendarData));
    const components = calendar.getAllSubcomponents("vevent");
    const masters = components.map((component) => new ICAL2.Event(component)).filter((event) => !event.isRecurrenceException());
    const exceptions = components.map((component) => new ICAL2.Event(component)).filter((event) => event.isRecurrenceException());
    return masters.flatMap((event) => {
      if (!event.uid || !event.startDate)
        throw new Error("VEVENT is missing UID or DTSTART.");
      if (!range || !event.isRecurring()) {
        if (range && !intersects(event.startDate, event.endDate, range))
          return [];
        return [
          mappedEvent(
            resource,
            calendarId,
            event,
            event.startDate,
            event.endDate
          )
        ];
      }
      const output = [];
      const iterator = event.iterator();
      let occurrence;
      while (occurrence = iterator.next()) {
        if (occurrence.toJSDate() >= range.end) break;
        if (occurrence.toJSDate() < range.start) continue;
        const details = event.getOccurrenceDetails(occurrence);
        if (!isCancelled(details.item) && intersects(details.startDate, details.endDate, range)) {
          output.push(
            mappedEvent(
              resource,
              calendarId,
              details.item,
              details.startDate,
              details.endDate,
              details.recurrenceId,
              event
            )
          );
        }
        if (output.length > range.maxOccurrences) {
          throw new CalDavError(
            "CALDAV_PROTOCOL_ERROR",
            "Recurring event exceeds the configured occurrence limit."
          );
        }
      }
      for (const exception of exceptions.filter(
        (item) => item.uid === event.uid && !isCancelled(item)
      )) {
        if (!intersects(exception.startDate, exception.endDate, range))
          continue;
        const mapped = mappedEvent(
          resource,
          calendarId,
          exception,
          exception.startDate,
          exception.endDate,
          exception.recurrenceId,
          event
        );
        if (!output.some((item) => item.id === mapped.id)) output.push(mapped);
      }
      output.sort((left, right) => left.start.localeCompare(right.start));
      return output;
    });
  } catch (error) {
    if (error instanceof CalDavError) throw error;
    throw new CalDavError(
      "CALDAV_PROTOCOL_ERROR",
      "A calendar resource contains invalid event data.",
      void 0,
      { cause: error }
    );
  }
}
function resourceUrl(resourceId) {
  try {
    if (resourceId.length > 5500) throw new Error("Identifier is too long.");
    const value = Buffer.from(resourceId, "base64url").toString("utf8");
    if (!URL.canParse(value) || value.length > 4096)
      throw new Error("Invalid URL.");
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.pathname.toLowerCase().endsWith(".ics") || url.search || url.hash)
      throw new Error("Invalid calendar resource URL.");
    return url.href;
  } catch {
    throw new CalDavError(
      "NOT_FOUND",
      "The requested event resource was not found.",
      404
    );
  }
}

// src/calendar/task-mapper.ts
import { createHash as createHash4 } from "crypto";
import ICAL3 from "ical.js";
function timeValue(value) {
  if (!(value instanceof ICAL3.Time)) return void 0;
  return value.isDate ? value.toString().slice(0, 10) : value.toJSDate().toISOString();
}
function textValue(component, name) {
  const value = component.getFirstPropertyValue(name);
  return typeof value === "string" && value ? value : void 0;
}
function recurrenceRule3(component) {
  const value = component.getFirstPropertyValue("rrule");
  return value instanceof ICAL3.Recur ? value.toString() : void 0;
}
function componentRecurrenceId(component) {
  const value = component.getFirstPropertyValue("recurrence-id");
  return value instanceof ICAL3.Time ? value : void 0;
}
function taskRelationships(component) {
  let parentUid;
  const childUids = [];
  for (const property of component.getAllProperties("related-to")) {
    const value = property.getFirstValue();
    if (typeof value !== "string" || !value) continue;
    const parameter = property.getParameter("reltype");
    const relationship = typeof parameter === "string" ? parameter.toLowerCase() : "parent";
    if (relationship === "parent" && !parentUid) parentUid = value;
    if (relationship === "child") childUids.push(value);
  }
  return {
    ...parentUid ? { parentUid } : {},
    ...childUids.length > 0 ? { childUids } : {}
  };
}
function mappedTask(resource, calendarId, component, startValue, dueValue, recurrenceId, seriesRule) {
  const uid = textValue(component, "uid");
  if (!uid) throw new Error("VTODO is missing UID.");
  const statusValue = textValue(component, "status")?.toLowerCase();
  const status = statusValue === "in-process" || statusValue === "completed" || statusValue === "cancelled" ? statusValue : "needs-action";
  const completedAt = timeValue(component.getFirstPropertyValue("completed"));
  const priorityValue = component.getFirstPropertyValue("priority");
  const priority = typeof priorityValue === "number" && Number.isInteger(priorityValue) && priorityValue >= 0 && priorityValue <= 9 ? priorityValue : 0;
  const rule = seriesRule ?? recurrenceRule3(component);
  const identity = recurrenceId?.toString() ?? uid;
  const description = textValue(component, "description");
  const category = textValue(component, "x-leo-category");
  const color = textValue(component, "x-leo-color");
  const startTaskUid = textValue(component, "x-leo-start-task-uid");
  const startGateFlag = textValue(component, "x-leo-start-gate");
  const relationships = taskRelationships(component);
  return {
    id: createHash4("sha256").update(`${resource.url}\0${uid}\0${identity}`).digest("base64url").slice(0, 30),
    resourceId: Buffer.from(resource.url).toString("base64url"),
    calendarId,
    uid,
    title: textValue(component, "summary") ?? "(untitled)",
    ...timeValue(startValue) ? { start: timeValue(startValue) } : {},
    ...timeValue(dueValue) ? { due: timeValue(dueValue) } : {},
    allDay: Boolean(startValue?.isDate || dueValue?.isDate),
    ...description ? { description } : {},
    ...category ? { category } : {},
    ...color ? { color } : {},
    ...startTaskUid ? { startTaskUid } : {},
    ...(startGateFlag === "true" || startGateFlag === "false") ? { startGate: startGateFlag === "true" } : {},
    status,
    completed: status === "completed" || Boolean(completedAt),
    ...completedAt ? { completedAt } : {},
    priority,
    version: resource.etag,
    entryType: "todo",
    recurring: Boolean(rule),
    ...rule ? { recurrenceRule: rule } : {},
    ...recurrenceId ? { recurrenceId: recurrenceId.toString() } : {},
    ...relationships
  };
}
function mapTaskResource(resource, calendarId, range) {
  try {
    const calendar = new ICAL3.Component(ICAL3.parse(resource.calendarData));
    const components = calendar.getAllSubcomponents("vtodo");
    const masters = components.filter(
      (component) => !component.hasProperty("recurrence-id")
    );
    const exceptions = components.filter(
      (component) => component.hasProperty("recurrence-id")
    );
    return masters.flatMap((component) => {
      const startValue = component.getFirstPropertyValue("dtstart");
      const dueValue = component.getFirstPropertyValue("due");
      const start = startValue instanceof ICAL3.Time ? startValue : void 0;
      const due = dueValue instanceof ICAL3.Time ? dueValue : void 0;
      const rule = recurrenceRule3(component);
      const anchor = start ?? due;
      if (!range || !rule || !anchor)
        return [mappedTask(resource, calendarId, component, start, due)];
      const dueOffset = start && due ? due.subtractDate(start) : void 0;
      const expansion = new ICAL3.RecurExpansion({ component, dtstart: anchor });
      const output = [];
      let occurrence;
      while (occurrence = expansion.next()) {
        const occurrenceId = occurrence;
        const occurrenceStart = start ? occurrenceId : void 0;
        const occurrenceDue = due ? start ? occurrenceId.clone() : occurrenceId : void 0;
        if (occurrenceDue && dueOffset) occurrenceDue.addDuration(dueOffset);
        const display = occurrenceDue ?? occurrenceStart;
        if (!display) break;
        const instant = display.toJSDate();
        if (instant >= range.end) break;
        if (instant >= range.start) {
          const exception = exceptions.find(
            (item) => textValue(item, "uid") === textValue(component, "uid") && componentRecurrenceId(item)?.toString() === occurrenceId.toString()
          );
          const exceptionStatus = exception ? textValue(exception, "status")?.toLowerCase() : void 0;
          if (exceptionStatus !== "cancelled") {
            const exceptionStart = exception?.getFirstPropertyValue("dtstart");
            const exceptionDue = exception?.getFirstPropertyValue("due");
            output.push(
              mappedTask(
                resource,
                calendarId,
                exception ?? component,
                exceptionStart instanceof ICAL3.Time ? exceptionStart : occurrenceStart,
                exceptionDue instanceof ICAL3.Time ? exceptionDue : occurrenceDue,
                occurrenceId,
                rule
              )
            );
          }
        }
        if (output.length > range.maxOccurrences)
          throw new CalDavError(
            "CALDAV_PROTOCOL_ERROR",
            "Recurring task exceeds the configured occurrence limit."
          );
      }
      return output;
    });
  } catch (error) {
    if (error instanceof CalDavError) throw error;
    throw new CalDavError(
      "CALDAV_PROTOCOL_ERROR",
      "A calendar resource contains invalid task data.",
      void 0,
      { cause: error }
    );
  }
}

// src/calendar/task-editor.ts
import { randomUUID as randomUUID2 } from "crypto";
import ICAL4 from "ical.js";
function utcNow2() {
  return ICAL4.Time.fromJSDate(/* @__PURE__ */ new Date(), true);
}
function taskTime(value, allDay) {
  if (allDay) return ICAL4.Time.fromDateString(value.slice(0, 10));
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid task date-time.");
  return ICAL4.Time.fromJSDate(date, true);
}
function apply2(component, input) {
  component.updatePropertyWithValue("summary", input.title);
  const effectiveStart = input.start ?? (typeof input.recurrenceRule === "string" ? input.due : void 0);
  if (effectiveStart)
    component.updatePropertyWithValue(
      "dtstart",
      taskTime(effectiveStart, input.allDay)
    );
  else component.removeAllProperties("dtstart");
  if (input.due)
    component.updatePropertyWithValue("due", taskTime(input.due, input.allDay));
  else component.removeAllProperties("due");
  if (input.description)
    component.updatePropertyWithValue("description", input.description);
  else component.removeAllProperties("description");
  component.updatePropertyWithValue("status", input.status.toUpperCase());
  component.updatePropertyWithValue("priority", input.priority);
  if (input.category !== void 0) component.updatePropertyWithValue("x-leo-category", input.category);
  if (input.color !== void 0) component.updatePropertyWithValue("x-leo-color", input.color);
  if (input.startGate !== void 0) component.updatePropertyWithValue("x-leo-start-gate", input.startGate ? "true" : "false");
  if (input.startTaskUid !== void 0) {
    if (input.startTaskUid) component.updatePropertyWithValue("x-leo-start-task-uid", input.startTaskUid);
    else component.removeAllProperties("x-leo-start-task-uid");
  }
  if (input.status === "completed") {
    component.updatePropertyWithValue("completed", utcNow2());
    component.updatePropertyWithValue("percent-complete", 100);
  } else {
    component.removeAllProperties("completed");
    component.removeAllProperties("percent-complete");
  }
  if (typeof input.recurrenceRule === "string") {
    component.updatePropertyWithValue(
      "rrule",
      ICAL4.Recur.fromString(input.recurrenceRule)
    );
  } else if (input.recurrenceRule === null) {
    component.removeAllProperties("rrule");
  }
  if (input.parentUid !== void 0) {
    for (const property of component.getAllProperties("related-to")) {
      const relation = property.getParameter("reltype");
      if (relation === void 0 || typeof relation === "string" && relation.toLowerCase() === "parent")
        component.removeProperty(property);
    }
    if (input.parentUid) {
      const property = new ICAL4.Property("related-to");
      property.setParameter("reltype", "PARENT");
      property.setValue(input.parentUid);
      component.addProperty(property);
    }
  }
  component.updatePropertyWithValue("dtstamp", utcNow2());
}
function masterInput(component, input) {
  if (!input.recurrenceId || !input.occurrenceStart) return input;
  const submittedAnchor = input.start ?? input.due;
  if (!submittedAnchor) return input;
  const submitted = new Date(submittedAnchor).getTime();
  const opened = new Date(input.occurrenceStart).getTime();
  if (!Number.isFinite(submitted) || !Number.isFinite(opened)) return input;
  const delta = submitted - opened;
  const shifted = (name) => {
    const value = component.getFirstPropertyValue(name);
    if (!(value instanceof ICAL4.Time)) return void 0;
    const milliseconds = value.toJSDate().getTime() + delta;
    return input.allDay ? new Date(milliseconds).toISOString().slice(0, 10) : new Date(milliseconds).toISOString();
  };
  const start = shifted("dtstart");
  const due = shifted("due");
  return {
    ...input,
    ...start ? { start } : { start: void 0 },
    ...due ? { due } : { due: void 0 }
  };
}
function parsedCalendar2(source) {
  return new ICAL4.Component(ICAL4.parse(source));
}
function masterTask(calendar) {
  const component = calendar.getAllSubcomponents("vtodo").find((item) => !item.hasProperty("recurrence-id"));
  if (!component) throw new Error("Master VTODO was not found.");
  return component;
}
function recurrenceTime2(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? ICAL4.Time.fromDateString(value) : ICAL4.Time.fromDateTimeString(value);
}
function componentRecurrenceId2(component) {
  const value = component.getFirstPropertyValue("recurrence-id");
  return value instanceof ICAL4.Time ? value.toString() : void 0;
}
function occurrenceTask(calendar, master, id) {
  const existing = calendar.getAllSubcomponents("vtodo").find((component2) => componentRecurrenceId2(component2) === id.toString());
  if (existing) return existing;
  const component = ICAL4.Component.fromString(master.toString());
  for (const name of ["rrule", "rdate", "exdate"])
    component.removeAllProperties(name);
  component.updatePropertyWithValue("recurrence-id", id);
  calendar.addSubcomponent(component);
  return component;
}
function createTaskData(input) {
  try {
    const calendar = new ICAL4.Component("vcalendar");
    calendar.updatePropertyWithValue("version", "2.0");
    calendar.updatePropertyWithValue(
      "prodid",
      "-//DayFront//CalDAV Client//EN"
    );
    const component = new ICAL4.Component("vtodo");
    component.updatePropertyWithValue("uid", randomUUID2());
    calendar.addSubcomponent(component);
    apply2(component, masterInput(component, input));
    return calendar.toString();
  } catch (error) {
    throw new CalDavError(
      "CALDAV_PROTOCOL_ERROR",
      "The task could not be created.",
      void 0,
      { cause: error }
    );
  }
}
function updateTaskData(source, input) {
  try {
    const calendar = parsedCalendar2(source);
    const master = masterTask(calendar);
    if (input.recurrenceScope === "occurrence" && input.recurrenceId) {
      const id = recurrenceTime2(input.recurrenceId);
      const exception = occurrenceTask(calendar, master, id);
      apply2(exception, { ...input, recurrenceRule: null });
      exception.updatePropertyWithValue("recurrence-id", id);
    } else {
      apply2(master, masterInput(master, input));
    }
    return calendar.toString();
  } catch (error) {
    if (error instanceof CalDavError) throw error;
    throw new CalDavError(
      "CALDAV_PROTOCOL_ERROR",
      "The task resource could not be edited.",
      void 0,
      { cause: error }
    );
  }
}
function deleteTaskOccurrenceData(source, occurrenceId) {
  try {
    const calendar = parsedCalendar2(source);
    const master = masterTask(calendar);
    const id = recurrenceTime2(occurrenceId);
    for (const component of calendar.getAllSubcomponents("vtodo")) {
      if (componentRecurrenceId2(component) === id.toString())
        calendar.removeSubcomponent(component);
    }
    master.addPropertyWithValue("exdate", id);
    master.updatePropertyWithValue("dtstamp", utcNow2());
    return calendar.toString();
  } catch (error) {
    if (error instanceof CalDavError) throw error;
    throw new CalDavError(
      "CALDAV_PROTOCOL_ERROR",
      "The recurring task occurrence could not be deleted.",
      void 0,
      { cause: error }
    );
  }
}

// src/calendar/subscriptions.ts
var MAX_FEED_BYTES = 10 * 1024 * 1024;
var PREFIX = "subscription:";
var CalendarSubscriptionService = class {
  constructor(subscriptions2, logger2, fetchFeed = fetch, now = Date.now) {
    this.logger = logger2;
    this.fetchFeed = fetchFeed;
    this.now = now;
    this.active = subscriptions2.filter((item) => item.enabled);
  }
  logger;
  fetchFeed;
  now;
  active;
  cache = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  calendars() {
    return this.active.map((item) => ({
      id: `${PREFIX}${item.id}`,
      displayName: item.name,
      ...item.color ? { color: item.color } : {},
      components: ["VEVENT"],
      readOnly: true
    }));
  }
  isCalendar(id) {
    return id.startsWith(PREFIX);
  }
  async events(selected, start, end, maxOccurrences) {
    const subscriptions2 = this.active.filter(
      (item) => selected ? selected.has(`${PREFIX}${item.id}`) : true
    );
    const results = await Promise.allSettled(
      subscriptions2.map(async (item) => {
        const feed = await this.load(item);
        const resource = {
          // Never expose a configured feed URL (which may contain a secret token)
          // through the event resource identifier returned to the browser.
          url: `https://subscription.invalid/${encodeURIComponent(item.id)}.ics`,
          etag: feed.etag,
          calendarData: feed.calendarData
        };
        return mapCalendarResource(resource, `${PREFIX}${item.id}`, {
          start,
          end,
          maxOccurrences
        }).map((event) => ({ ...event, readOnly: true }));
      })
    );
    const events = [];
    const warnings = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") events.push(...result.value);
      else {
        const item = subscriptions2[index];
        warnings.push(`Could not load ${item?.name ?? "external calendar"}.`);
        this.logger.warn(
          { subscriptionId: item?.id },
          "external calendar subscription could not be loaded"
        );
      }
    });
    return { events, warnings };
  }
  load(item) {
    const cached = this.cache.get(item.id);
    if (cached && cached.refreshAt > this.now()) return Promise.resolve(cached);
    const current = this.pending.get(item.id);
    if (current) return current;
    const request = this.refresh(item, cached).finally(
      () => this.pending.delete(item.id)
    );
    this.pending.set(item.id, request);
    return request;
  }
  async refresh(item, stale) {
    try {
      const headers = new Headers({
        accept: "text/calendar, text/plain;q=0.8"
      });
      if (stale?.etag) headers.set("if-none-match", stale.etag);
      if (stale?.lastModified)
        headers.set("if-modified-since", stale.lastModified);
      const response = await this.fetchFeed(item.url, {
        headers,
        signal: AbortSignal.timeout(3e4)
      });
      if (response.status === 304 && stale) {
        const refreshed2 = {
          ...stale,
          refreshAt: this.now() + item.refreshIntervalMs
        };
        this.cache.set(item.id, refreshed2);
        return refreshed2;
      }
      if (!response.ok)
        throw new Error(`Feed returned HTTP ${response.status}.`);
      const declaredSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > MAX_FEED_BYTES)
        throw new Error("Feed exceeds the 10 MB size limit.");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_FEED_BYTES)
        throw new Error("Feed exceeds the 10 MB size limit.");
      const calendarData = new TextDecoder().decode(bytes);
      if (!/^BEGIN:VCALENDAR\s*$/im.test(calendarData))
        throw new Error("Response is not an iCalendar feed.");
      const refreshed = {
        calendarData,
        etag: response.headers.get("etag") ?? `subscription-${this.now()}`,
        ...response.headers.get("last-modified") ? { lastModified: response.headers.get("last-modified") } : {},
        refreshAt: this.now() + item.refreshIntervalMs
      };
      this.cache.set(item.id, refreshed);
      return refreshed;
    } catch (error) {
      if (stale) {
        this.logger.warn(
          { subscriptionId: item.id },
          "using stale external calendar subscription"
        );
        return stale;
      }
      throw error;
    }
  }
};

// src/calendar/routes.ts
function mapError(error) {
  if (!(error instanceof CalDavError)) {
    return new ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
  }
  const statuses = {
    AUTHENTICATION_FAILED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    VERSION_CONFLICT: 412,
    REQUEST_TIMEOUT: 504,
    CALDAV_UNAVAILABLE: 503,
    CALDAV_PROTOCOL_ERROR: 502
  };
  return new ApiError(statuses[error.code] ?? 502, error.code, error.message);
}
function toCalendar(collection) {
  return {
    id: collection.id,
    displayName: collection.displayName,
    ...collection.description ? { description: collection.description } : {},
    ...collection.color ? { color: collection.color } : {},
    components: [...collection.components],
    readOnly: false
  };
}
function dateQuery(value, name) {
  if (typeof value !== "string") {
    throw new ApiError(400, "VALIDATION_FAILED", `${name} is required.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${name} must be an RFC 3339 date-time.`
    );
  }
  return date;
}
function selectedIds(value) {
  if (value === void 0) return void 0;
  const values = Array.isArray(value) ? value : [value];
  const ids = values.flatMap(
    (item) => typeof item === "string" ? item.split(",").filter(Boolean) : []
  );
  return new Set(ids);
}
function mutation(value) {
  const result = eventMutationSchema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "The event could not be validated.",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    );
  }
  return result.data;
}
function calendarMutation(value) {
  const result = calendarMutationSchema.safeParse(value);
  if (!result.success)
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "The calendar could not be validated.",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    );
  return result.data;
}
function taskMutation(value) {
  const result = taskMutationSchema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "The task could not be validated.",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    );
  }
  return result.data;
}
function matchVersion(value) {
  if (!value) {
    throw new ApiError(428, "PRECONDITION_REQUIRED", "If-Match is required.");
  }
  return value;
}
function calendarRouter(clientProvider, maxOccurrences = 5e3, subscriptions2) {
  const router = Router();
  const requestStorage = new AsyncLocalStorage();
  const clientFor = typeof clientProvider === "function" ? (request) => clientProvider(request) : () => clientProvider;
  const client = new Proxy({}, {
    get(_target, property) {
      const request = requestStorage.getStore();
      if (!request)
        throw new Error("CalDAV client requested outside a request context.");
      const value = clientFor(request)[property];
      return typeof value === "function" ? value.bind(clientFor(request)) : value;
    }
  });
  router.use((request, _response, next) => requestStorage.run(request, next));
  router.get("/calendars", async (_request, response) => {
    try {
      const discovery = await client.discover();
      response.json({
        data: [
          ...discovery.calendars.map(toCalendar),
          ...subscriptions2?.calendars() ?? []
        ],
        meta: { requestId: String(response.locals.requestId) }
      });
    } catch (error) {
      throw mapError(error);
    }
  });
  router.post("/calendars", async (request, response) => {
    const input = calendarMutation(request.body);
    try {
      const discovery = await client.discover();
      const url = new URL(`${randomUUID3()}/`, discovery.calendarHomeUrl).href;
      await client.createCalendar(discovery.calendarHomeUrl, url, input);
      const updated = await client.discover();
      const calendar = updated.calendars.find((item) => item.url === url);
      if (!calendar)
        throw new ApiError(
          502,
          "CALDAV_PROTOCOL_ERROR",
          "The created calendar was not returned by the CalDAV server."
        );
      response.status(201).json({
        data: toCalendar(calendar),
        meta: { requestId: String(response.locals.requestId) }
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });
  router.put("/calendars/:calendarId", async (request, response) => {
    if (subscriptions2?.isCalendar(request.params.calendarId))
      throw new ApiError(403, "FORBIDDEN", "External calendars are read-only.");
    const input = calendarMutation(request.body);
    try {
      const discovery = await client.discover();
      const current = discovery.calendars.find(
        (item) => item.id === request.params.calendarId
      );
      if (!current)
        throw new ApiError(404, "NOT_FOUND", "Calendar was not found.");
      await client.updateCalendar(current.url, input);
      const updated = await client.discover();
      const calendar = updated.calendars.find(
        (item) => item.id === request.params.calendarId
      );
      if (!calendar)
        throw new ApiError(404, "NOT_FOUND", "Calendar was not found.");
      response.json({
        data: toCalendar(calendar),
        meta: { requestId: String(response.locals.requestId) }
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });
  router.delete("/calendars/:calendarId", async (request, response) => {
    if (subscriptions2?.isCalendar(request.params.calendarId))
      throw new ApiError(403, "FORBIDDEN", "External calendars are read-only.");
    try {
      const discovery = await client.discover();
      const calendar = discovery.calendars.find(
        (item) => item.id === request.params.calendarId
      );
      if (!calendar)
        throw new ApiError(404, "NOT_FOUND", "Calendar was not found.");
      await client.deleteCalendar(calendar.url);
      response.status(204).send();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });
  router.get("/events", async (request, response) => {
    const start = dateQuery(request.query.start, "start");
    const end = dateQuery(request.query.end, "end");
    const ids = selectedIds(request.query.calendarId);
    try {
      const discovery = await client.discover();
      const calendars = discovery.calendars.filter(
        (calendar) => calendar.components.includes("VEVENT") && (!ids || ids.has(calendar.id))
      );
      const results = await Promise.allSettled(
        calendars.map(async (calendar) => {
          const resources = await client.queryCalendar(
            calendar.url,
            start,
            end
          );
          return resources.flatMap(
            (resource) => mapCalendarResource(resource, calendar.id, {
              start,
              end,
              maxOccurrences
            })
          );
        })
      );
      const events = [];
      const warnings = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") events.push(...result.value);
        else
          warnings.push(
            `Could not load ${calendars[index]?.displayName ?? "calendar"}.`
          );
      });
      const external = subscriptions2 ? await subscriptions2.events(ids, start, end, maxOccurrences) : { events: [], warnings: [] };
      events.push(...external.events);
      warnings.push(...external.warnings);
      response.json({
        data: events,
        meta: {
          requestId: String(response.locals.requestId),
          ...warnings.length > 0 ? { warnings } : {}
        }
      });
    } catch (error) {
      throw mapError(error);
    }
  });
  router.get("/events/search", async (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim() : void 0;
    if (query && query.length > 200)
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        "q must contain no more than 200 characters."
      );
    const ids = selectedIds(request.query.calendarId);
    try {
      const discovery = await client.discover();
      const calendars = discovery.calendars.filter(
        (calendar) => calendar.components.includes("VEVENT") && (!ids || ids.has(calendar.id))
      );
      const results = await Promise.allSettled(
        calendars.map(
          async (calendar) => (await client.searchCalendar(calendar.url, query)).flatMap(
            (resource) => mapCalendarResource(resource, calendar.id)
          )
        )
      );
      const events = results.flatMap(
        (result) => result.status === "fulfilled" ? result.value : []
      );
      events.sort((left, right) => left.start.localeCompare(right.start));
      response.json({
        data: events,
        meta: { requestId: String(response.locals.requestId) }
      });
    } catch (error) {
      throw mapError(error);
    }
  });
  router.get("/tasks", async (request, response) => {
    const hasRange = request.query.start !== void 0 || request.query.end !== void 0;
    const start = hasRange ? dateQuery(request.query.start, "start") : void 0;
    const end = hasRange ? dateQuery(request.query.end, "end") : void 0;
    const ids = selectedIds(request.query.calendarId);
    const requestedStatus = typeof request.query.status === "string" ? request.query.status.toLowerCase() : void 0;
    try {
      const discovery = await client.discover();
      const calendars = discovery.calendars.filter(
        (calendar) => calendar.components.includes("VTODO") && (!ids || ids.has(calendar.id))
      );
      const results = await Promise.allSettled(
        calendars.map(async (calendar) => {
          const resources = await client.queryTasks(calendar.url, start, end);
          return resources.flatMap(
            (resource) => mapTaskResource(
              resource,
              calendar.id,
              start && end ? { start, end, maxOccurrences } : void 0
            )
          );
        })
      );
      const tasks = [];
      const warnings = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") tasks.push(...result.value);
        else
          warnings.push(
            `Could not load tasks from ${calendars[index]?.displayName ?? "calendar"}.`
          );
      });
      const filtered = requestedStatus ? tasks.filter((task) => task.status === requestedStatus) : tasks;
      response.json({
        data: filtered,
        meta: {
          requestId: String(response.locals.requestId),
          ...warnings.length ? { warnings } : {}
        }
      });
    } catch (error) {
      throw mapError(error);
    }
  });
  router.post("/calendars/:calendarId/events", async (request, response) => {
    if (subscriptions2?.isCalendar(request.params.calendarId))
      throw new ApiError(403, "FORBIDDEN", "External calendars are read-only.");
    const input = mutation(request.body);
    if (input.calendarId !== request.params.calendarId) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        "Calendar IDs do not match."
      );
    }
    try {
      const discovery = await client.discover();
      const calendar = discovery.calendars.find(
        (item) => item.id === input.calendarId
      );
      if (!calendar)
        throw new ApiError(404, "NOT_FOUND", "Calendar was not found.");
      const url = new URL(`${randomUUID3()}.ics`, calendar.url).href;
      await client.putResource(url, createEventData(input));
      const resource = await client.getResource(url);
      const event = mapCalendarResource(resource, calendar.id)[0];
      if (!event)
        throw new ApiError(
          502,
          "CALDAV_PROTOCOL_ERROR",
          "Created event was not returned."
        );
      response.status(201).json({
        data: event,
        meta: { requestId: String(response.locals.requestId) }
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });
  router.post("/calendars/:calendarId/tasks", async (request, response) => {
    if (subscriptions2?.isCalendar(request.params.calendarId))
      throw new ApiError(403, "FORBIDDEN", "External calendars are read-only.");
    const input = taskMutation(request.body);
    if (input.calendarId !== request.params.calendarId)
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        "Calendar IDs do not match."
      );
    try {
      const discovery = await client.discover();
      const calendar = discovery.calendars.find(
        (item) => item.id === input.calendarId && item.components.includes("VTODO")
      );
      if (!calendar)
        throw new ApiError(404, "NOT_FOUND", "Task calendar was not found.");
      const url = new URL(`${randomUUID3()}.ics`, calendar.url).href;
      await client.putResource(url, createTaskData(input));
      const resource = await client.getResource(url);
      const task = mapTaskResource(resource, calendar.id)[0];
      if (!task)
        throw new ApiError(
          502,
          "CALDAV_PROTOCOL_ERROR",
          "Created task was not returned."
        );
      response.status(201).json({
        data: task,
        meta: { requestId: String(response.locals.requestId) }
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });
  router.get("/tasks/:resourceId", async (request, response) => {
    const calendarId = request.query.calendarId;
    if (typeof calendarId !== "string") {
      throw new ApiError(400, "VALIDATION_FAILED", "calendarId is required.");
    }
    try {
      const resource = await client.getResource(
        resourceUrl(request.params.resourceId)
      );
      const task = mapTaskResource(resource, calendarId)[0];
      if (!task) throw new ApiError(404, "NOT_FOUND", "Task was not found.");
      response.json({
        data: task,
        meta: { requestId: String(response.locals.requestId) }
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });
  router.put("/tasks/:resourceId", async (request, response) => {
    const input = taskMutation(request.body);
    const version = matchVersion(request.header("if-match"));
    try {
      const url = resourceUrl(request.params.resourceId);
      const current = await client.getResource(url);
      const discovery = await client.discover();
      const source = [...discovery.calendars].sort((left, right) => right.url.length - left.url.length).find((calendar) => url.startsWith(calendar.url));
      const target = discovery.calendars.find(
        (calendar) => calendar.id === input.calendarId && calendar.components.includes("VTODO")
      );
      if (!source || !target)
        throw new ApiError(404, "NOT_FOUND", "Task calendar was not found.");
      const moving = source.id !== target.id;
      if (moving && input.recurrenceScope === "occurrence")
        throw new ApiError(
          400,
          "VALIDATION_FAILED",
          "A single recurring occurrence cannot be moved to another calendar."
        );
      const updatedData = updateTaskData(current.calendarData, input);
      const updatedUrl = moving ? new URL(`${randomUUID3()}.ics`, target.url).href : url;
      await client.putResource(
        updatedUrl,
        updatedData,
        moving ? void 0 : version
      );
      const updated = await client.getResource(updatedUrl);
      if (moving) {
        try {
          await client.deleteResource(url, version);
        } catch (error) {
          await client.deleteResource(updatedUrl, updated.etag).catch(() => void 0);
          throw error;
        }
      }
      const task = mapTaskResource(updated, input.calendarId)[0];
      if (!task) throw new ApiError(404, "NOT_FOUND", "Task was not found.");
      response.json({
        data: task,
        meta: { requestId: String(response.locals.requestId) }
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });
  router.delete("/tasks/:resourceId", async (request, response) => {
    const version = matchVersion(request.header("if-match"));
    try {
      const url = resourceUrl(request.params.resourceId);
      if (request.query.scope === "occurrence") {
        const recurrenceId = request.query.recurrenceId;
        if (typeof recurrenceId !== "string")
          throw new ApiError(
            400,
            "VALIDATION_FAILED",
            "recurrenceId is required for occurrence deletion."
          );
        const current = await client.getResource(url);
        await client.putResource(
          url,
          deleteTaskOccurrenceData(current.calendarData, recurrenceId),
          version
        );
      } else {
        await client.deleteResource(url, version);
      }
      response.status(204).send();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });
  router.get("/events/:resourceId", async (request, response) => {
    const calendarId = request.query.calendarId;
    if (typeof calendarId !== "string") {
      throw new ApiError(400, "VALIDATION_FAILED", "calendarId is required.");
    }
    try {
      const resource = await client.getResource(
        resourceUrl(request.params.resourceId)
      );
      const event = mapCalendarResource(resource, calendarId)[0];
      if (!event) throw new ApiError(404, "NOT_FOUND", "Event was not found.");
      response.json({
        data: event,
        meta: { requestId: String(response.locals.requestId) }
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });
  router.put("/events/:resourceId", async (request, response) => {
    const input = mutation(request.body);
    const version = matchVersion(request.header("if-match"));
    try {
      const url = resourceUrl(request.params.resourceId);
      const current = await client.getResource(url);
      const discovery = await client.discover();
      const source = [...discovery.calendars].sort((left, right) => right.url.length - left.url.length).find((calendar) => url.startsWith(calendar.url));
      const target = discovery.calendars.find(
        (calendar) => calendar.id === input.calendarId && calendar.components.includes("VEVENT")
      );
      if (!source || !target)
        throw new ApiError(404, "NOT_FOUND", "Event calendar was not found.");
      const moving = source.id !== target.id;
      if (moving && input.recurrenceScope === "occurrence")
        throw new ApiError(
          400,
          "VALIDATION_FAILED",
          "A single recurring occurrence cannot be moved to another calendar."
        );
      const updatedData = updateEventData(current.calendarData, input);
      const updatedUrl = moving ? new URL(`${randomUUID3()}.ics`, target.url).href : url;
      await client.putResource(
        updatedUrl,
        updatedData,
        moving ? void 0 : version
      );
      const updated = await client.getResource(updatedUrl);
      if (moving) {
        try {
          await client.deleteResource(url, version);
        } catch (error) {
          await client.deleteResource(updatedUrl, updated.etag).catch(() => void 0);
          throw error;
        }
      }
      const event = mapCalendarResource(updated, input.calendarId)[0];
      if (!event) throw new ApiError(404, "NOT_FOUND", "Event was not found.");
      response.json({
        data: event,
        meta: { requestId: String(response.locals.requestId) }
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });
  router.delete("/events/:resourceId", async (request, response) => {
    const version = matchVersion(request.header("if-match"));
    try {
      const url = resourceUrl(request.params.resourceId);
      if (request.query.scope === "occurrence") {
        const recurrenceId = request.query.recurrenceId;
        if (typeof recurrenceId !== "string") {
          throw new ApiError(
            400,
            "VALIDATION_FAILED",
            "recurrenceId is required for occurrence deletion."
          );
        }
        const current = await client.getResource(url);
        await client.putResource(
          url,
          deleteOccurrenceData(current.calendarData, recurrenceId),
          version
        );
      } else {
        await client.deleteResource(url, version);
      }
      response.status(204).send();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });
  return router;
}

// src/security.ts
function securityHeaders() {
  return (request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()"
    );
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
    );
    if (request.secure)
      response.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
    next();
  };
}
function mutationRateLimit(limit = 120, windowMs = 6e4) {
  const buckets = /* @__PURE__ */ new Map();
  return (request, response, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      next();
      return;
    }
    const now = Date.now();
    const key2 = request.ip ?? "unknown";
    const current = buckets.get(key2);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    bucket.count += 1;
    buckets.set(key2, bucket);
    response.setHeader("RateLimit-Limit", String(limit));
    response.setHeader(
      "RateLimit-Reset",
      String(Math.ceil((bucket.resetAt - now) / 1e3))
    );
    if (bucket.count > limit) {
      response.setHeader("Retry-After", String(Math.ceil(windowMs / 1e3)));
      next(
        new ApiError(
          429,
          "RATE_LIMITED",
          "Too many calendar changes. Try again shortly."
        )
      );
      return;
    }
    next();
  };
}

// src/app.ts
function createApp({
  config: config2,
  logger: logger2,
  caldav,
  webRoot: webRoot2,
  subscriptionFetch,
  caldavFetch
}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config2.server.trustProxy);
  app.use(securityHeaders());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    (request, response, next) => {
      const requestId = request.header("x-request-id") ?? randomUUID4();
      response.locals.requestId = requestId;
      response.setHeader("x-request-id", requestId);
      response.on("finish", () => {
        logger2.info(
          {
            requestId,
            method: request.method,
            path: request.path,
            status: response.statusCode
          },
          "request completed"
        );
      });
      next();
    }
  );
  const authentication = createAuthentication(
    config2,
    caldavFetch ? { fetch: caldavFetch } : {}
  );
  app.use(authentication.session);
  app.get(
    "/health",
    (_request, response) => {
      const body = {
        data: { status: "ok", service: "dayfront-api" },
        meta: { requestId: response.locals.requestId }
      };
      response.json(body);
    }
  );
  app.get(
    "/ready",
    (_request, response) => {
      const body = {
        data: {
          status: "not-ready",
          checks: { configuration: "ok", caldav: "pending" }
        },
        meta: { requestId: response.locals.requestId }
      };
      response.status(503).json(body);
    }
  );
  app.get("/api/v1/config", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({
      data: getPublicConfig(config2),
      meta: { requestId: String(response.locals.requestId) }
    });
  });
  app.get("/api/v1/auth/session", authentication.status);
  app.post(
    "/api/v1/auth/login",
    authentication.requireSameOrigin,
    authentication.login
  );
  app.post(
    "/api/v1/auth/logout",
    authentication.requireSameOrigin,
    authentication.logout
  );
  app.use(
    "/api/v1",
    (_request, response, next) => {
      response.setHeader("Cache-Control", "no-store");
      next();
    },
    authentication.requireSession,
    authentication.requireSameOrigin,
    mutationRateLimit(),
    calendarRouter(
      config2.authentication.mode === "caldav-login" ? (request) => authentication.client(request) : caldav ?? new CalDavClient(config2.caldav),
      config2.calendar.maxOccurrences,
      new CalendarSubscriptionService(
        config2.calendarSubscriptions,
        logger2,
        subscriptionFetch
      )
    )
  );
  if (webRoot2) {
    const index = resolve(webRoot2, "index.html");
    app.use(express.static(webRoot2, { index: false }));
    app.use((request, response, next) => {
      if (request.method === "GET" && !request.path.startsWith("/api/") && request.accepts("html")) {
        response.sendFile(index);
        return;
      }
      next();
    });
  }
  app.use(notFoundHandler());
  app.use(errorHandler(logger2));
  return app;
}

// src/logger.ts
import pino from "pino";
var redactPaths = [
  "password",
  "caldav.password",
  "config.caldav.password",
  "req.headers.authorization",
  "request.headers.authorization",
  "headers.authorization"
];
function createLogger(config2, destination) {
  const options = {
    level: config2.level,
    redact: { paths: redactPaths, censor: "[Redacted]" }
  };
  if (destination) return pino(options, destination);
  if (config2.format === "pretty") {
    return pino(
      options,
      pino.transport({ target: "pino-pretty", options: { colorize: true } })
    );
  }
  return pino(options);
}

// src/server.ts
var config;
try {
  config = loadConfig();
} catch (error) {
  const message = error instanceof ConfigurationError ? error.message : "DayFront configuration could not be loaded.";
  console.error(message);
  process.exit(1);
}
var logger = createLogger(config.logging);
for (const warning of getConfigurationWarnings(config)) logger.warn(warning);
var { host, port } = config.server;
var webRoot = process.env.DAYFRONT_WEB_ROOT;
var server = createApp({
  config,
  logger,
  ...webRoot ? { webRoot } : {}
}).listen(port, host, () => {
  logger.info({ host, port }, "DayFront API listening");
});
var shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down DayFront API");
  const forcedShutdown = setTimeout(() => {
    logger.error("DayFront API graceful shutdown timed out");
    server.closeAllConnections();
    process.exitCode = 1;
  }, 1e4);
  forcedShutdown.unref();
  server.closeIdleConnections();
  server.close((error) => {
    clearTimeout(forcedShutdown);
    if (error) {
      logger.error({ err: error }, "DayFront API shutdown failed");
      process.exitCode = 1;
    } else {
      logger.info("DayFront API shutdown complete");
    }
  });
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
//# sourceMappingURL=server.js.map