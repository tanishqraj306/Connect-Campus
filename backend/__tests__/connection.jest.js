import { jest } from "@jest/globals";

// ==========================================
// 1. DEFINE MOCKS (Must be before imports)
// ==========================================

// Mock Email Handler
await jest.unstable_mockModule("../emails/emailHandlers.js", () => ({
  sendConnectionAcceptedEmail: jest.fn(),
}));

// Mock Notification Model
await jest.unstable_mockModule("../models/notification.model.js", () => {
  const mockNotification = jest.fn().mockImplementation((data) => ({
    ...data,
    save: jest.fn().mockResolvedValue(true),
  }));
  return { default: mockNotification };
});

// Mock ConnectionRequest Model
await jest.unstable_mockModule("../models/connectionRequest.model.js", () => {
  const mockConnectionRequest = jest.fn().mockImplementation((data) => ({
    ...data,
    save: jest.fn().mockResolvedValue(true),
  }));

  mockConnectionRequest.findOne = jest.fn();
  mockConnectionRequest.findById = jest.fn();
  mockConnectionRequest.find = jest.fn();

  return { default: mockConnectionRequest };
});

// Mock User Model
await jest.unstable_mockModule("../models/user.model.js", () => ({
  default: {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
}));

// ==========================================
// 2. DYNAMIC IMPORTS
// ==========================================
const {
  sendConnectionRequest,
  acceptConnectionRequest,
  rejectConnectionRequest,
  getConnectionStatus,
} = await import("../controllers/connection.controller.js");

const ConnectionRequest = (await import("../models/connectionRequest.model.js"))
  .default;
const User = (await import("../models/user.model.js")).default;
const { sendConnectionAcceptedEmail } = await import(
  "../emails/emailHandlers.js"
);

// ==========================================
// 3. THE TESTS
// ==========================================
describe("Connection Controller Tests", () => {
  const mockRequest = (user, params = {}, body = {}) => ({
    user,
    params,
    body,
  });

  const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- SEND CONNECTION REQUEST ---
  describe("sendConnectionRequest", () => {
    test("Should return 400 if sending to self", async () => {
      const req = mockRequest({ _id: "me", connections: [] }, { userId: "me" });
      const res = mockResponse();

      await sendConnectionRequest(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "You can't send a request to yourself",
      });
    });

    test("Should return 400 if already connected", async () => {
      const req = mockRequest(
        { _id: "me", connections: ["other"] },
        { userId: "other" },
      );
      const res = mockResponse();

      await sendConnectionRequest(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "You are already connected",
      });
    });

    test("Should return 400 if request already pending", async () => {
      const req = mockRequest(
        { _id: "me", connections: [] },
        { userId: "other" },
      );
      const res = mockResponse();

      // Mock finding an existing pending request
      ConnectionRequest.findOne.mockResolvedValue({ status: "pending" });

      await sendConnectionRequest(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "A connection request already exists",
      });
    });

    test("Should return 201 on Success", async () => {
      const req = mockRequest(
        { _id: "me", connections: [] },
        { userId: "other" },
      );
      const res = mockResponse();

      ConnectionRequest.findOne.mockResolvedValue(null); // No existing request

      await sendConnectionRequest(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: "Connection request sent successfully",
      });
    });
  });

  // --- ACCEPT CONNECTION REQUEST ---
  describe("acceptConnectionRequest", () => {
    test("Should return 404 if request not found", async () => {
      const req = mockRequest({ _id: "me" }, { requestId: "invalid" });
      const res = mockResponse();

      // Mock chain: findById -> populate -> populate -> resolve(null)
      const mockChain = {
        populate: jest.fn().mockReturnThis(),
        then: jest.fn((callback) => callback(null)), // resolve to null
      };
      // Note: Mongoose queries are thenables. We simulate that structure.
      ConnectionRequest.findById.mockReturnValue(mockChain);

      // Because the controller uses await, it expects a Promise-like object
      // The simplest way to mock chained populate in Jest for async/await:
      ConnectionRequest.findById.mockImplementation(() => ({
        populate: () => ({
          populate: () => Promise.resolve(null),
        }),
      }));

      await acceptConnectionRequest(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test("Should return 200 and accept request", async () => {
      const req = mockRequest({ _id: "recipientId" }, { requestId: "req123" });
      const res = mockResponse();

      const mockReqData = {
        _id: "req123",
        status: "pending",
        sender: { _id: "senderId", name: "Sender", email: "s@s.com" },
        recipient: { _id: "recipientId", name: "Recipient" },
        save: jest.fn(),
      };

      // Mock the populate chain returning mockReqData
      ConnectionRequest.findById.mockImplementation(() => ({
        populate: () => ({
          populate: () => Promise.resolve(mockReqData),
        }),
      }));

      await acceptConnectionRequest(req, res);

      expect(mockReqData.status).toBe("accepted");
      expect(User.findByIdAndUpdate).toHaveBeenCalledTimes(2); // Update both users
      expect(sendConnectionAcceptedEmail).toHaveBeenCalled(); // Check email sent
      expect(res.json).toHaveBeenCalledWith({
        message: "Connection accepted successfully",
      });
    });
  });

  // --- REJECT CONNECTION REQUEST ---
  describe("rejectConnectionRequest", () => {
    test("Should return 403 if not authorized (wrong user)", async () => {
      const req = mockRequest({ _id: "intruder" }, { requestId: "req123" });
      const res = mockResponse();

      ConnectionRequest.findById.mockResolvedValue({
        recipient: "actualUser", // String comparison
        toString: () => "actualUser", // Safety for .toString() calls
      });

      await rejectConnectionRequest(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test("Should return 200 on Success", async () => {
      const req = mockRequest({ _id: "me" }, { requestId: "req123" });
      const res = mockResponse();

      const mockReq = {
        recipient: "me",
        status: "pending",
        save: jest.fn(),
      };
      ConnectionRequest.findById.mockResolvedValue(mockReq);

      await rejectConnectionRequest(req, res);
      expect(mockReq.status).toBe("rejected");
      expect(res.json).toHaveBeenCalledWith({
        message: "Connection request rejected",
      });
    });
  });

  // --- GET CONNECTION STATUS ---
  describe("getConnectionStatus", () => {
    test('Should return "connected" if users are connected', async () => {
      const req = mockRequest(
        { _id: "me", connections: ["friend"] },
        { userId: "friend" },
      );
      const res = mockResponse();

      await getConnectionStatus(req, res);
      expect(res.json).toHaveBeenCalledWith({ status: "connected" });
    });

    test('Should return "not_connected" if no request exists', async () => {
      const req = mockRequest(
        { _id: "me", connections: [] },
        { userId: "stranger" },
      );
      const res = mockResponse();

      ConnectionRequest.findOne.mockResolvedValue(null);

      await getConnectionStatus(req, res);
      expect(res.json).toHaveBeenCalledWith({ status: "not_connected" });
    });
  });
});
