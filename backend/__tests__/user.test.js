import { jest } from "@jest/globals";

// ==========================================
// 1. DEFINE MOCKS
// ==========================================

// Mock Cloudinary
await jest.unstable_mockModule("../lib/cloudinary.js", () => ({
  default: {
    uploader: {
      upload: jest.fn(),
    },
  },
}));

// Mock User Model (Handling Chaining .select().limit())
const mockQuery = {
  select: jest.fn().mockReturnThis(), // Returns self to allow chaining
  limit: jest.fn().mockReturnThis(), // Returns self
  then: jest.fn((resolve) => resolve("mock_data")), // Default resolution
};

await jest.unstable_mockModule("../models/user.model.js", () => ({
  default: {
    findById: jest.fn(() => mockQuery),
    find: jest.fn(() => mockQuery),
    findOne: jest.fn(() => mockQuery),
    findByIdAndUpdate: jest.fn(() => mockQuery),
  },
}));

// ==========================================
// 2. DYNAMIC IMPORTS
// ==========================================
const { getSuggestedConnections, getPublicProfile, updateProfile } =
  await import("../controllers/user.controller.js");

const User = (await import("../models/user.model.js")).default;
const cloudinary = (await import("../lib/cloudinary.js")).default;

// ==========================================
// 3. THE TESTS
// ==========================================
describe("User Controller Tests", () => {
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

  // --- GET SUGGESTED CONNECTIONS ---
  describe("getSuggestedConnections", () => {
    test("Should fetch suggestions excluding self and current connections", async () => {
      const req = mockRequest({ _id: "me" });
      const res = mockResponse();

      // 1. Mock finding the Current User (to get their connections)
      // We need to intercept the first call to "then" (from User.findById)
      User.findById.mockImplementationOnce(() => ({
        select: jest.fn().mockResolvedValue({ connections: ["friend1"] }),
      }));

      // 2. Mock finding the Suggested Users
      User.find.mockImplementationOnce(() => ({
        select: () => ({
          limit: jest.fn().mockResolvedValue(["userA", "userB"]),
        }),
      }));

      await getSuggestedConnections(req, res);

      // Verify logic: $ne (not equal) me, $nin (not in) [friend1]
      expect(User.find).toHaveBeenCalledWith({
        _id: {
          $ne: "me",
          $nin: ["friend1"],
        },
      });
      expect(res.json).toHaveBeenCalledWith(["userA", "userB"]);
    });

    test("Should return 500 on error", async () => {
      const req = mockRequest({ _id: "me" });
      const res = mockResponse();

      User.findById.mockImplementation(() => {
        throw new Error("DB Error");
      });

      await getSuggestedConnections(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // --- GET PUBLIC PROFILE ---
  describe("getPublicProfile", () => {
    test("Path 1: User Found (Return User)", async () => {
      const req = mockRequest({}, { username: "testuser" });
      const res = mockResponse();

      // Mock successful find
      User.findOne.mockImplementation(() => ({
        select: jest.fn().mockResolvedValue({ name: "Test User" }),
      }));

      await getPublicProfile(req, res);

      expect(User.findOne).toHaveBeenCalledWith({ username: "testuser" });
      expect(res.json).toHaveBeenCalledWith({ name: "Test User" });
    });

    test("Path 2: User Not Found (404)", async () => {
      const req = mockRequest({}, { username: "ghost" });
      const res = mockResponse();

      // Mock finding null
      User.findOne.mockImplementation(() => ({
        select: jest.fn().mockResolvedValue(null),
      }));

      await getPublicProfile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: "User not found" });
    });
  });

  // --- UPDATE PROFILE ---
  describe("updateProfile", () => {
    test("Path 1: Update fields WITHOUT images", async () => {
      const req = mockRequest(
        { _id: "user1" },
        {},
        { name: "New Name", about: "New About" }, // Body
      );
      const res = mockResponse();

      // Mock update response
      User.findByIdAndUpdate.mockImplementation(() => ({
        select: jest.fn().mockResolvedValue({ name: "New Name" }),
      }));

      await updateProfile(req, res);

      // Cloudinary should NOT be called
      expect(cloudinary.uploader.upload).not.toHaveBeenCalled();
      // DB should be called with updated fields
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        "user1",
        { $set: { name: "New Name", about: "New About" } },
        { new: true },
      );
      expect(res.json).toHaveBeenCalled();
    });

    test("Path 2: Update WITH Profile Picture", async () => {
      const req = mockRequest(
        { _id: "user1" },
        {},
        { profilePicture: "base64image" },
      );
      const res = mockResponse();

      // Mock Cloudinary Success
      cloudinary.uploader.upload.mockResolvedValue({
        secure_url: "http://new-pic.com",
      });

      User.findByIdAndUpdate.mockImplementation(() => ({
        select: jest
          .fn()
          .mockResolvedValue({ profilePicture: "http://new-pic.com" }),
      }));

      await updateProfile(req, res);

      expect(cloudinary.uploader.upload).toHaveBeenCalledWith("base64image");
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        "user1",
        { $set: { profilePicture: "http://new-pic.com" } },
        { new: true },
      );
    });

    test("Path 3: Update WITH Banner Image", async () => {
      const req = mockRequest(
        { _id: "user1" },
        {},
        { bannerImg: "base64banner" },
      );
      const res = mockResponse();

      cloudinary.uploader.upload.mockResolvedValue({
        secure_url: "http://new-banner.com",
      });

      // Mock chain
      User.findByIdAndUpdate.mockImplementation(() => ({
        select: jest.fn().mockResolvedValue({}),
      }));

      await updateProfile(req, res);

      expect(cloudinary.uploader.upload).toHaveBeenCalledWith("base64banner");
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.any(String),
        { $set: { bannerImg: "http://new-banner.com" } },
        expect.any(Object),
      );
    });
  });
});
