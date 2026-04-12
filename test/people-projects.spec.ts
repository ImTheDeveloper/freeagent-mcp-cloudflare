import { describe, expect, it } from "vitest";
import {
  buildCategoriesPath,
  buildCategoryPath,
  buildContactPath,
  buildContactsPath,
  buildPriceListItemPath,
  buildPriceListItemsPath,
  buildProjectPath,
  buildProjectsPath,
  buildTaskPath,
  buildTasksPath,
  buildTimeslipPath,
  buildTimeslipsPath,
  buildUserPath,
  buildUsersPath,
} from "../src/freeagent/resources";

describe("freeagent people, project, and reference resource helpers", () => {
  it("builds contacts and projects paths with supported filters", () => {
    expect(
      buildContactsPath({
        page: 2,
        perPage: 25,
        view: "clients",
        sort: "-updated_at",
        updatedSince: "2026-04-01T00:00:00.000Z",
      }),
    ).toBe(
      "/v2/contacts?page=2&per_page=25&view=clients&sort=-updated_at&updated_since=2026-04-01T00%3A00%3A00.000Z",
    );
    expect(buildContactPath("123")).toBe("/v2/contacts/123");

    expect(
      buildProjectsPath({
        page: 1,
        perPage: 50,
        view: "active",
        sort: "contact_name",
        nested: true,
        contact: "https://api.freeagent.com/v2/contacts/2",
      }),
    ).toBe(
      "/v2/projects?page=1&per_page=50&view=active&sort=contact_name&nested=true&contact=https%3A%2F%2Fapi.freeagent.com%2Fv2%2Fcontacts%2F2",
    );
    expect(buildProjectPath("abc")).toBe("/v2/projects/abc");
  });

  it("builds tasks and timeslips paths with supported filters", () => {
    expect(
      buildTasksPath({
        page: 3,
        perPage: 10,
        view: "active",
        sort: "updated_at",
        updatedSince: "2026-04-01",
        project: "https://api.freeagent.com/v2/projects/5",
      }),
    ).toBe(
      "/v2/tasks?page=3&per_page=10&view=active&sort=updated_at&updated_since=2026-04-01&project=https%3A%2F%2Fapi.freeagent.com%2Fv2%2Fprojects%2F5",
    );
    expect(buildTaskPath("88")).toBe("/v2/tasks/88");

    expect(
      buildTimeslipsPath({
        page: 4,
        perPage: 25,
        fromDate: "2026-01-01",
        toDate: "2026-01-31",
        updatedSince: "2026-02-01T00:00:00.000Z",
        view: "unbilled",
        nested: true,
        user: "https://api.freeagent.com/v2/users/1",
        task: "https://api.freeagent.com/v2/tasks/2",
        project: "https://api.freeagent.com/v2/projects/3",
      }),
    ).toBe(
      "/v2/timeslips?page=4&per_page=25&from_date=2026-01-01&to_date=2026-01-31&updated_since=2026-02-01T00%3A00%3A00.000Z&view=unbilled&nested=true&user=https%3A%2F%2Fapi.freeagent.com%2Fv2%2Fusers%2F1&task=https%3A%2F%2Fapi.freeagent.com%2Fv2%2Ftasks%2F2&project=https%3A%2F%2Fapi.freeagent.com%2Fv2%2Fprojects%2F3",
    );
    expect(buildTimeslipPath("25")).toBe("/v2/timeslips/25");
  });

  it("builds user, category, and price list item paths", () => {
    expect(buildUsersPath({ page: 2, perPage: 100, view: "active_staff" })).toBe(
      "/v2/users?page=2&per_page=100&view=active_staff",
    );
    expect(buildUserPath("me")).toBe("/v2/users/me");

    expect(buildCategoriesPath({ subAccounts: true })).toBe("/v2/categories?sub_accounts=true");
    expect(buildCategoryPath("750-1")).toBe("/v2/categories/750-1");

    expect(buildPriceListItemsPath({ page: 1, perPage: 100, sort: "-updated_at" })).toBe(
      "/v2/price_list_items?page=1&per_page=100&sort=-updated_at",
    );
    expect(buildPriceListItemPath("17")).toBe("/v2/price_list_items/17");
  });
});
