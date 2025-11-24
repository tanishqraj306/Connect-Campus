import { jest } from "@jest/globals";

// ==========================================
// 1. DEFINE MOCKS
// ==========================================

// Mock Notification Model with "Chainable" methods
const mockChain = {
  sort: jest.fn().mockReturnThis(), // Return self to allow .sort().populate()
  populate: jest.fn().mockReturnThis(), // Return self to allow .populate().populate()
  then: jest.fn((resolve) => resolve(["mock_notification"])), // Allow "await" to resolve data
};

await jest.unstable_mockModule("../models/notification.model.js", () => ({
  default: {
    // When .find() is called, return the chain object defined above
    find: jest.fn(() => mockChain),
    findByIdAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn(),
  },
}));

// ==========================================
// 2. DYNAMIC IMPORTS
// ==========================================
const { getUserNotifications, markNotificationAsRead, deleteNotification } =
  await import("../controllers/notification.controller.js");

const Notification = (await import("../models/notification.model.js")).default;

// ==========================================
// 3. THE TESTS
// ==========================================
describe("Notification Controller Tests", () => {
  const mockRequest = (user, params = {}) => ({
    user,
    params,
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

  // --- GET USER NOTIFICATIONS ---
  describe("getUserNotifications", () => {
    test("Should return 200 and notifications on success", async () => {
      const req = mockRequest({ _id: "user123" });
      const res = mockResponse();

      // The mockChain defined at the top will handle .find().sort().populate()
      // We just need to verify the chain was called

      await getUserNotifications(req, res);

      // Verify the logic flow
      expect(Notification.find).toHaveBeenCalledWith({ recipient: "user123" });
      expect(mockChain.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(mockChain.populate).toHaveBeenCalledTimes(2); // Called twice
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(["mock_notification"]);
    });

    test("Should return 500 on server error", async () => {
      const req = mockRequest({ _id: "user123" });
      const res = mockResponse();

      // Force .find() to throw an error immediately
      Notification.find.mockImplementationOnce(() => {
        throw new Error("DB Error");
      });

      await getUserNotifications(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Internal server error",
      });
    });
  });

  // --- MARK AS READ ---
  describe("markNotificationAsRead", () => {
    test("Should mark notification as read and return result", async () => {
      const req = mockRequest({ _id: "user123" }, { id: "notif1" });
      const res = mockResponse();

      const mockUpdatedNotification = { _id: "notif1", read: true };
      Notification.findByIdAndUpdate.mockResolvedValue(mockUpdatedNotification);

      await markNotificationAsRead(req, res);

      expect(Notification.findByIdAndUpdate).toHaveBeenCalledWith(
        { _id: "notif1", recipient: "user123" },
        { read: true },
        { new: true },
      );
      expect(res.json).toHaveBeenCalledWith(mockUpdatedNotification);
    });

    test("Should return 500 on error", async () => {
      const req = mockRequest({ _id: "user123" }, { id: "notif1" });
      const res = mockResponse();

      Notification.findByIdAndUpdate.mockRejectedValue(new Error("DB Error"));

      await markNotificationAsRead(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // --- DELETE NOTIFICATION ---
  describe("deleteNotification", () => {
    test("Should delete notification and return success message", async () => {
      const req = mockRequest({ _id: "user123" }, { id: "notif1" });
      const res = mockResponse();

      Notification.findOneAndDelete.mockResolvedValue(true);

      await deleteNotification(req, res);

      expect(Notification.findOneAndDelete).toHaveBeenCalledWith({
        _id: "notif1",
        recipient: "user123",
      });
      expect(res.json).toHaveBeenCalledWith({
        message: "Notification deleted successfully",
      });
    });

    test("Should return 500 on error", async () => {
      const req = mockRequest({ _id: "user123" }, { id: "notif1" });
      const res = mockResponse();

      Notification.findOneAndDelete.mockRejectedValue(new Error("DB Error"));

      await deleteNotification(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
