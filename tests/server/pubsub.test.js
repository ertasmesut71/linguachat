/**
 * E3 — Pub/sub adapter tests.
 *
 * These test the LOCAL (in-process EventEmitter) path only, which is
 * what runs when REDIS_URL is not set. The Redis path uses the same
 * interface but requires a running Redis instance — testing that is
 * an integration-test concern, not a unit-test concern.
 *
 * What we verify:
 *   - init() returns "local" when REDIS_URL is unset
 *   - publish() → subscribe() delivers messages synchronously
 *   - multiple subscribers on the same channel all fire
 *   - different channels are independent
 *   - _resetForTests() clears state so subsequent init re-reads env
 *   - the instance-ID dedup pattern works (application-level, not built
 *     into pubsub itself — we just verify publish/subscribe wiring)
 */

const pubsub = require("../../server/utils/pubsub");

describe("pubsub adapter (E3)", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    pubsub._resetForTests();
  });

  afterAll(() => {
    pubsub._resetForTests();
  });

  test("init() returns 'local' when REDIS_URL is unset", () => {
    const mode = pubsub.init();
    expect(mode).toBe("local");
    expect(pubsub.getMode()).toBe("local");
  });

  test("publish/subscribe delivers messages synchronously in local mode", () => {
    pubsub.init();
    const received = [];
    pubsub.subscribe("test:channel", (data) => received.push(data));

    pubsub.publish("test:channel", { hello: "world" });
    pubsub.publish("test:channel", { count: 2 });

    // Synchronous in local mode — received immediately
    expect(received).toEqual([{ hello: "world" }, { count: 2 }]);
  });

  test("multiple subscribers on same channel all receive", () => {
    pubsub.init();
    const a = [], b = [];
    pubsub.subscribe("multi", (d) => a.push(d));
    pubsub.subscribe("multi", (d) => b.push(d));

    pubsub.publish("multi", { x: 1 });

    expect(a).toEqual([{ x: 1 }]);
    expect(b).toEqual([{ x: 1 }]);
  });

  test("different channels are independent", () => {
    pubsub.init();
    const ch1 = [], ch2 = [];
    pubsub.subscribe("chan1", (d) => ch1.push(d));
    pubsub.subscribe("chan2", (d) => ch2.push(d));

    pubsub.publish("chan1", { from: "chan1" });
    pubsub.publish("chan2", { from: "chan2" });

    expect(ch1).toEqual([{ from: "chan1" }]);
    expect(ch2).toEqual([{ from: "chan2" }]);
  });

  test("_resetForTests clears subscriptions and allows re-init", () => {
    pubsub.init();
    const received = [];
    pubsub.subscribe("ephemeral", (d) => received.push(d));
    pubsub.publish("ephemeral", { a: 1 });
    expect(received).toHaveLength(1);

    pubsub._resetForTests();
    expect(pubsub.getMode()).toBeNull();

    // Re-init and subscribe on the same channel — old subscriber is gone
    pubsub.init();
    pubsub.publish("ephemeral", { a: 2 });
    // Old subscriber should NOT have received this
    expect(received).toHaveLength(1);
  });

  test("auto-inits on first publish if init was not called explicitly", () => {
    // Don't call init() — publish should auto-init in local mode
    const received = [];
    pubsub.subscribe("auto", (d) => received.push(d));
    pubsub.publish("auto", { auto: true });
    expect(received).toEqual([{ auto: true }]);
    expect(pubsub.getMode()).toBe("local");
  });

  test("instance-ID dedup pattern works at application level", () => {
    // This tests the PATTERN used by socketServer.js, not a built-in
    // pubsub feature. We're verifying that publish→subscribe→filter
    // correctly prevents double delivery.
    const INSTANCE_A = "instance-a";
    const INSTANCE_B = "instance-b";

    pubsub.init();
    const deliveredToA = [], deliveredToB = [];

    // Simulate two "instances" — both subscribe to ws:relay
    pubsub.subscribe("ws:relay", (msg) => {
      if (msg.iid === INSTANCE_A) return; // A skips own messages
      deliveredToA.push(msg);
    });
    pubsub.subscribe("ws:relay", (msg) => {
      if (msg.iid === INSTANCE_B) return; // B skips own messages
      deliveredToB.push(msg);
    });

    // Instance A publishes
    pubsub.publish("ws:relay", { iid: INSTANCE_A, uid: "user1", event: "message:new", payload: { text: "hi" } });

    // A should NOT receive its own message; B should receive it
    expect(deliveredToA).toHaveLength(0);
    expect(deliveredToB).toHaveLength(1);
    expect(deliveredToB[0].uid).toBe("user1");

    // Instance B publishes
    pubsub.publish("ws:relay", { iid: INSTANCE_B, uid: "user2", event: "typing:start", payload: {} });

    // B should NOT receive its own; A should
    expect(deliveredToA).toHaveLength(1);
    expect(deliveredToA[0].uid).toBe("user2");
    expect(deliveredToB).toHaveLength(1); // still 1 (didn't receive its own)
  });

  test("getMode returns null before init", () => {
    expect(pubsub.getMode()).toBeNull();
  });
});
