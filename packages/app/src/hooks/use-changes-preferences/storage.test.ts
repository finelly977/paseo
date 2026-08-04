import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createInMemoryKeyValueStorage } from "./fakes";
import {
  CHANGES_PREFERENCES_QUERY_KEY,
  CHANGES_PREFERENCES_STORAGE_KEY,
  DEFAULT_CHANGES_PREFERENCES,
  loadChangesPreferencesFromStorage,
  saveChangesPreferences,
} from "./storage";

describe("loadChangesPreferencesFromStorage", () => {
  it("defaults to unified layout with visible whitespace and writes the defaults back", async () => {
    const storage = createInMemoryKeyValueStorage();

    const result = await loadChangesPreferencesFromStorage(storage);

    expect(result).toEqual(DEFAULT_CHANGES_PREFERENCES);
    expect(storage.entries.get(CHANGES_PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify(DEFAULT_CHANGES_PREFERENCES),
    );
  });

  it("migrates the legacy wrap-lines toggle into the new preferences object", async () => {
    const storage = createInMemoryKeyValueStorage({ "diff-wrap-lines": "true" });

    const result = await loadChangesPreferencesFromStorage(storage);

    expect(result).toEqual({
      layout: "unified",
      viewMode: "flat",
      wrapLines: true,
      hideWhitespace: false,
      commitsCollapsed: false,
      commitsHeight: 520,
    });
    expect(storage.entries.get(CHANGES_PREFERENCES_STORAGE_KEY)).toBe(JSON.stringify(result));
  });

  it("loads persisted layout and whitespace preferences without rewriting storage", async () => {
    const persisted = JSON.stringify({
      layout: "split",
      viewMode: "tree",
      hideWhitespace: true,
      wrapLines: false,
    });
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: persisted,
    });

    const result = await loadChangesPreferencesFromStorage(storage);

    expect(result).toEqual({
      layout: "split",
      viewMode: "tree",
      hideWhitespace: true,
      wrapLines: false,
      commitsCollapsed: false,
      commitsHeight: 520,
    });
    expect(storage.entries.get(CHANGES_PREFERENCES_STORAGE_KEY)).toBe(persisted);
    expect(storage.entries.size).toBe(1);
  });
});

describe("changes preferences commitsCollapsed", () => {
  it("expands commits by default", () => {
    expect(DEFAULT_CHANGES_PREFERENCES.commitsCollapsed).toBe(false);
  });

  it("round-trips commitsCollapsed: false", async () => {
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: JSON.stringify({ commitsCollapsed: false }),
    });

    const prefs = await loadChangesPreferencesFromStorage(storage);

    expect(prefs.commitsCollapsed).toBe(false);
  });

  it("rejects invalid commitsCollapsed values", async () => {
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: JSON.stringify({ commitsCollapsed: "nope" }),
    });

    await expect(loadChangesPreferencesFromStorage(storage)).rejects.toThrow();
  });
});

describe("changes preferences commitsHeight", () => {
  it("defaults to 520 pixels", () => {
    expect(DEFAULT_CHANGES_PREFERENCES.commitsHeight).toBe(520);
  });

  it("round-trips a valid graph height", async () => {
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: JSON.stringify({ commitsHeight: 420 }),
    });

    const prefs = await loadChangesPreferencesFromStorage(storage);

    expect(prefs.commitsHeight).toBe(420);
  });

  it("rejects a graph height outside the supported range", async () => {
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: JSON.stringify({ commitsHeight: 900 }),
    });

    await expect(loadChangesPreferencesFromStorage(storage)).rejects.toThrow();
  });

  it("migrates the previous collapsed 280 pixel default", async () => {
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: JSON.stringify({
        commitsCollapsed: true,
        commitsHeight: 280,
      }),
    });

    const prefs = await loadChangesPreferencesFromStorage(storage);

    expect(prefs).toMatchObject({ commitsCollapsed: false, commitsHeight: 520 });
    expect(storage.entries.get(CHANGES_PREFERENCES_STORAGE_KEY)).toBe(JSON.stringify(prefs));
  });
});

describe("saveChangesPreferences", () => {
  it("merges updates onto cached preferences and persists the result", async () => {
    const storage = createInMemoryKeyValueStorage();
    const queryClient = new QueryClient();
    queryClient.setQueryData(CHANGES_PREFERENCES_QUERY_KEY, DEFAULT_CHANGES_PREFERENCES);

    await saveChangesPreferences({
      queryClient,
      updates: { layout: "split", viewMode: "tree", hideWhitespace: true },
      storage,
    });

    const expected = {
      ...DEFAULT_CHANGES_PREFERENCES,
      layout: "split",
      viewMode: "tree",
      hideWhitespace: true,
    };
    expect(queryClient.getQueryData(CHANGES_PREFERENCES_QUERY_KEY)).toEqual(expected);
    expect(storage.entries.get(CHANGES_PREFERENCES_STORAGE_KEY)).toBe(JSON.stringify(expected));
  });

  it("falls back to defaults when the query cache has no prior preferences", async () => {
    const storage = createInMemoryKeyValueStorage();
    const queryClient = new QueryClient();

    await saveChangesPreferences({
      queryClient,
      updates: { wrapLines: true },
      storage,
    });

    const expected = { ...DEFAULT_CHANGES_PREFERENCES, wrapLines: true };
    expect(storage.entries.get(CHANGES_PREFERENCES_STORAGE_KEY)).toBe(JSON.stringify(expected));
  });
});
