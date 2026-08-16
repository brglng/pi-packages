import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodePortableSessionDirName,
  type PortableNameOptions,
  portableSessionDirName,
  portableSessionDirNameToAbsolute,
} from "#src/portable-name";

const HOME = homedir();

const defaultOptions: PortableNameOptions = {
  homeLabel: "HOME",
  rootLabel: "ROOT",
  extraPrefixes: {},
};

describe("portableSessionDirName", () => {
  it("maps the home directory itself to the home label", () => {
    expect(portableSessionDirName(HOME, defaultOptions)).toBe("HOME");
  });

  it("replaces the home prefix with the home label and URL-encodes the remainder", () => {
    expect(
      portableSessionDirName(join(HOME, "my-project"), defaultOptions),
    ).toBe("HOME%2Fmy-project");
  });

  it("URL-encodes nested segments under the home directory", () => {
    expect(
      portableSessionDirName(
        join(HOME, "work", "repo with space"),
        defaultOptions,
      ),
    ).toBe("HOME%2Fwork%2Frepo%20with%20space");
  });

  it("does not treat a sibling of the home directory as inside the home", () => {
    const sibling = HOME.endsWith("/zpan")
      ? `${HOME.slice(0, -"zpan".length)}zpan2`
      : join(HOME, "..", "other-user");
    expect(portableSessionDirName(sibling, defaultOptions)).toMatch(/^ROOT/);
  });

  it("uses the root label for absolute paths outside the home", () => {
    const result = portableSessionDirName("/var/www", defaultOptions);
    expect(result).toMatch(/^ROOT/);
    expect(decodeURIComponent(result.slice("ROOT".length))).toBe("/var/www");
  });

  it("prefers the longest matching extra prefix", () => {
    const options: PortableNameOptions = {
      ...defaultOptions,
      extraPrefixes: {
        "/data": "DATA",
        "/data/backup": "BACKUP",
      },
    };
    expect(portableSessionDirName("/data/backup/old", options)).toBe(
      "BACKUP%2Fold",
    );
    expect(portableSessionDirName("/data/misc", options)).toBe("DATA%2Fmisc");
  });

  it("matches extra prefixes only at segment boundaries", () => {
    const options: PortableNameOptions = {
      ...defaultOptions,
      extraPrefixes: { "/data": "DATA" },
    };
    expect(portableSessionDirName("/database", options)).toMatch(/^ROOT/);
  });

  it("lets extra prefixes override the home directory", () => {
    const options: PortableNameOptions = {
      ...defaultOptions,
      extraPrefixes: { [HOME]: "MYHOME" },
    };
    expect(portableSessionDirName(join(HOME, "x"), options)).toBe("MYHOME%2Fx");
  });

  it("uses custom labels", () => {
    const options: PortableNameOptions = {
      homeLabel: "USER",
      rootLabel: "FS",
      extraPrefixes: {},
    };
    expect(portableSessionDirName(join(HOME, "x"), options)).toBe("USER%2Fx");
  });

  it("resolves relative paths against the working directory", () => {
    const result = portableSessionDirName("relative/path", defaultOptions);
    expect(result).toMatch(/^(HOME|ROOT)%2F/);
    expect(result).toContain("relative");
  });
});

describe("decodePortableSessionDirName", () => {
  it("decodes a home-prefixed name", () => {
    expect(
      decodePortableSessionDirName("HOME%2Fmy%20project", defaultOptions),
    ).toEqual({ label: "HOME", remainder: "/my project" });
  });

  it("decodes the bare home label", () => {
    expect(decodePortableSessionDirName("HOME", defaultOptions)).toEqual({
      label: "HOME",
      remainder: "",
    });
  });

  it("returns null for an unknown label", () => {
    expect(
      decodePortableSessionDirName("UNKNOWN%2Fx", defaultOptions),
    ).toBeNull();
  });

  it("returns null for malformed percent-encoding", () => {
    expect(decodePortableSessionDirName("HOME%2", defaultOptions)).toBeNull();
  });
});

describe("portableSessionDirNameToAbsolute", () => {
  it("round-trips a home-prefixed name", () => {
    const name = portableSessionDirName(join(HOME, "a", "b"), defaultOptions);
    expect(portableSessionDirNameToAbsolute(name, defaultOptions)).toBe(
      join(HOME, "a", "b"),
    );
  });

  it("round-trips an extra-prefixed name", () => {
    const options: PortableNameOptions = {
      ...defaultOptions,
      extraPrefixes: { "/data": "DATA" },
    };
    const name = portableSessionDirName("/data/x", options);
    expect(portableSessionDirNameToAbsolute(name, options)).toBe("/data/x");
  });

  it("round-trips a root-prefixed name", () => {
    const name = portableSessionDirName("/var/log", defaultOptions);
    expect(portableSessionDirNameToAbsolute(name, defaultOptions)).toBe(
      "/var/log",
    );
  });
});
