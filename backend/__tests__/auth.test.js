import { jest } from "@jest/globals";

// ==========================================
// 1. DEFINE MOCKS BEFORE IMPORTS
// We use unstable_mockModule to stop the real libraries from loading
// ==========================================

// Mock JSON Web Token (The source of your crash)
await jest.unstable_mockModule("jsonwebtoken", () => ({
  default: {
    sign: jest.fn(() => "mock_token"),
    verify: jest.fn(),
  },
  // Mock named exports just in case
  sign: jest.fn(() => "mock_token"),
  verify: jest.fn(),
}));

// Mock Bcrypt
await jest.unstable_mockModule("bcryptjs", () => ({
  default: {
    genSalt: jest.fn(),
    hash: jest.fn(),
    compare: jest.fn(),
  },
  genSalt: jest.fn(),
  hash: jest.fn(),
  compare: jest.fn(),
}));

// Mock User Model
await jest.unstable_mockModule("../models/user.model.js", () => {
  const mockUser = jest.fn().mockImplementation((data) => ({
    ...data,
    _id: "mock_user_id",
    save: jest.fn().mockResolvedValue(true),
  }));

  mockUser.findOne = jest.fn();

  return { default: mockUser };
});

// Mock Email Handler
await jest.unstable_mockModule("../emails/emailHandlers.js", () => ({
  sendWelcomeEmail: jest.fn(),
}));

// ==========================================
// 2. DYNAMIC IMPORTS
// Now we import the controller. It will use the mocks above.
// ==========================================
const { signup, login, logout, getCurrentUser } = await import(
  "../controllers/auth.controller.js"
);
const User = (await import("../models/user.model.js")).default;
const bcrypt = (await import("bcryptjs")).default;

// ==========================================
// 3. THE TESTS
// ==========================================
describe("Auth Controller Path Coverage", () => {
  const mockRequest = (body, user = {}) => ({
    body,
    user,
  });

  const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.cookie = jest.fn().mockReturnValue(res);
    res.clearCookie = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- LOGIN TESTS ---
  describe("Login Controller", () => {
    test("Should return 400 if User does not exist", async () => {
      const req = mockRequest({ username: "wrong", password: "123" });
      const res = mockResponse();
      User.findOne.mockResolvedValue(null); // User not found

      await login(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("Should return 400 if Password does not match", async () => {
      const req = mockRequest({ username: "test", password: "wrong" });
      const res = mockResponse();

      // Found user, but password wrong
      User.findOne.mockResolvedValue({ username: "test", password: "hash" });
      bcrypt.compare.mockResolvedValue(false);

      await login(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("Should return 200 on Success", async () => {
      const req = mockRequest({ username: "test", password: "correct" });
      const res = mockResponse();

      // Found user, password correct
      User.findOne.mockResolvedValue({
        _id: "123",
        username: "test",
        password: "hash",
      });
      bcrypt.compare.mockResolvedValue(true);

      await login(req, res);
      expect(res.cookie).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Logged in successfully" }),
      );
    });
  });

  // --- LOGOUT TESTS ---
  describe("Logout Controller", () => {
    test("Should clear cookie and return success", () => {
      const req = mockRequest({});
      const res = mockResponse();

      logout(req, res);

      expect(res.clearCookie).toHaveBeenCalledWith("jwt-connect-campus");
      expect(res.json).toHaveBeenCalledWith({
        message: "Logged out successfully",
      });
    });
  });

  // --- GET CURRENT USER TESTS ---
  describe("getCurrentUser", () => {
    test("Should return the user from request", async () => {
      const mockUser = { _id: "123", name: "Test" };
      const req = mockRequest({}, mockUser);
      const res = mockResponse();

      await getCurrentUser(req, res);

      expect(res.json).toHaveBeenCalledWith(mockUser);
    });
  });

  // --- SIGNUP TESTS ---
  describe("Signup Controller", () => {
    test("Should return 400 if fields are missing", async () => {
      const req = mockRequest({ email: "" }); // Missing fields
      const res = mockResponse();

      await signup(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("Should return 400 if Email exists", async () => {
      const req = mockRequest({
        name: "T",
        username: "u",
        email: "e",
        password: "p",
      });
      const res = mockResponse();

      User.findOne.mockResolvedValueOnce({ email: "e" }); // Email found

      await signup(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Email already exists",
      });
    });

    test("Should return 400 if Username exists", async () => {
      const req = mockRequest({
        name: "T",
        username: "u",
        email: "new@email.com",
        password: "p",
      });
      const res = mockResponse();

      User.findOne
        .mockResolvedValueOnce(null) // Email check passes
        .mockResolvedValueOnce({ username: "u" }); // Username check fails

      await signup(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Username already exists",
      });
    });

    test("Should return 400 if Password is too short", async () => {
      const req = mockRequest({
        name: "T",
        username: "u",
        email: "e@e.com",
        password: "123", // Too short
      });
      const res = mockResponse();

      User.findOne.mockResolvedValue(null); // No conflicts

      await signup(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Password must be at least 6 characters",
      });
    });

    test("Should return 201 on Success", async () => {
      const req = mockRequest({
        name: "T",
        username: "new",
        email: "new",
        password: "password123",
      });
      const res = mockResponse();

      User.findOne.mockResolvedValue(null); // No conflicts
      bcrypt.genSalt.mockResolvedValue("salt");
      bcrypt.hash.mockResolvedValue("hash");

      // User constructor was mocked at top to return object with .save()

      await signup(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "User registered successfully" }),
      );
    });
  });
});
