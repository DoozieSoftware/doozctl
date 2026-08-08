const request = require("supertest");
const app = require("../src/app.js");

describe("app", () => {
  it("responds", async () => {
    await request(app).get("/").expect(200);
  });
});
