import { jest } from "@jest/globals";

// ==========================================
// 1. DEFINE MOCKS (Must be before imports)
// ==========================================

// Mock Cloudinary
await jest.unstable_mockModule("../lib/cloudinary.js", () => ({
  default: {
    uploader: {
      upload: jest.fn(),
      destroy: jest.fn(),
    },
  },
}));

// Mock Email Handler
await jest.unstable_mockModule("../emails/emailHandlers.js", () => ({
  sendCommentNotificationEmail: jest.fn(),
}));

// Mock Notification Model
await jest.unstable_mockModule("../models/notification.model.js", () => {
  const mockNotification = jest.fn().mockImplementation((data) => ({
    ...data,
    save: jest.fn().mockResolvedValue(true),
  }));
  return { default: mockNotification };
});

// Mock Post Model (Complex Chaining Support)
const mockQuery = {
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  then: jest.fn((resolve) => resolve(["mock_post"])),
};

await jest.unstable_mockModule("../models/post.model.js", () => {
  const mockPost = jest.fn().mockImplementation((data) => ({
    ...data,
    save: jest.fn().mockResolvedValue(true),
  }));

  // Attach static methods
  mockPost.find = jest.fn(() => mockQuery);
  mockPost.findById = jest.fn();
  mockPost.findByIdAndUpdate = jest.fn();
  mockPost.findByIdAndDelete = jest.fn();

  return { default: mockPost };
});

// ==========================================
// 2. DYNAMIC IMPORTS
// ==========================================
const {
  getFeedPosts,
  createPost,
  deletePost,
  getPostById,
  createComment,
  likePost,
} = await import("../controllers/post.controller.js");

const Post = (await import("../models/post.model.js")).default;
const cloudinary = (await import("../lib/cloudinary.js")).default;
const { sendCommentNotificationEmail } = await import(
  "../emails/emailHandlers.js"
);

// ==========================================
// 3. THE TESTS
// ==========================================
describe("Post Controller Tests", () => {
  const mockRequest = (user, body = {}, params = {}) => ({
    user,
    body,
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

  // --- CREATE POST ---
  describe("createPost", () => {
    test("Path 1: Create post WITH image (calls Cloudinary)", async () => {
      const req = mockRequest(
        { _id: "user1" },
        { content: "Hello", image: "base64img" },
      );
      const res = mockResponse();

      cloudinary.uploader.upload.mockResolvedValue({
        secure_url: "http://img.com",
      });

      await createPost(req, res);

      expect(cloudinary.uploader.upload).toHaveBeenCalledWith("base64img");
      expect(res.status).toHaveBeenCalledWith(201);
      // Verify new Post() was called with image url
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          image: "http://img.com",
          content: "Hello",
        }),
      );
    });

    test("Path 2: Create post WITHOUT image", async () => {
      const req = mockRequest({ _id: "user1" }, { content: "Text Only" });
      const res = mockResponse();

      await createPost(req, res);

      expect(cloudinary.uploader.upload).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  // --- DELETE POST ---
  describe("deletePost", () => {
    test("Path 1: Post not found (404)", async () => {
      const req = mockRequest({ _id: "user1" }, {}, { id: "post1" });
      const res = mockResponse();

      Post.findById.mockResolvedValue(null);

      await deletePost(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test("Path 2: Unauthorized user (403)", async () => {
      const req = mockRequest({ _id: "user1" }, {}, { id: "post1" });
      const res = mockResponse();

      Post.findById.mockResolvedValue({
        author: "user2",
        toString: () => "obj",
      }); // Author mismatch

      await deletePost(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test("Path 3: Success with Image (Calls destroy)", async () => {
      const req = mockRequest({ _id: "user1" }, {}, { id: "post1" });
      const res = mockResponse();

      Post.findById.mockResolvedValue({
        author: "user1",
        image: "https://res.cloudinary.com/demo/image/upload/v123/sample.jpg",
      });

      await deletePost(req, res);

      expect(cloudinary.uploader.destroy).toHaveBeenCalled(); // Should attempt to delete image
      expect(Post.findByIdAndDelete).toHaveBeenCalledWith("post1");
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // --- GET FEED POSTS ---
  describe("getFeedPosts", () => {
    test("Should fetch posts with correct chaining", async () => {
      const req = mockRequest({ _id: "user1", connections: ["user2"] });
      const res = mockResponse();

      await getFeedPosts(req, res);

      // Verify the complex query structure
      expect(Post.find).toHaveBeenCalledWith({
        author: { $in: ["user2", "user1"] },
      });
      // Verify chain
      expect(mockQuery.populate).toHaveBeenCalledTimes(2);
      expect(mockQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // --- CREATE COMMENT ---
  describe("createComment", () => {
    test("Path 1: Comment triggers notification (Different User)", async () => {
      const req = mockRequest(
        { _id: "commenter", name: "Bob" },
        { content: "Nice!" },
        { id: "post1" },
      );
      const res = mockResponse();

      // Mock finding post and updating it
      const mockPost = {
        author: { _id: "author1", email: "a@a.com", name: "Alice" },
      };

      // Mock chain for findByIdAndUpdate
      const updateChain = {
        populate: jest.fn().mockResolvedValue(mockPost),
      };
      Post.findByIdAndUpdate.mockReturnValue(updateChain);

      await createComment(req, res);

      // Notification email should be sent because commenter != author
      expect(sendCommentNotificationEmail).toHaveBeenCalledWith(
        "a@a.com",
        "Alice",
        "Bob",
        expect.any(String),
        "Nice!",
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test("Path 2: No notification if commenting on own post", async () => {
      const req = mockRequest(
        { _id: "me", name: "Me" },
        { content: "Bump" },
        { id: "post1" },
      );
      const res = mockResponse();

      const mockPost = {
        author: { _id: "me", email: "me@me.com" },
      };

      Post.findByIdAndUpdate.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockPost),
      });

      await createComment(req, res);

      expect(sendCommentNotificationEmail).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // --- LIKE POST ---
  describe("likePost", () => {
    test("Path 1: Like a post (Push ID)", async () => {
      const req = mockRequest({ _id: "user1" }, {}, { id: "post1" });
      const res = mockResponse();

      const mockPost = {
        likes: [],
        author: "user2", // Different user, so trigger notification
        save: jest.fn(),
      };
      Post.findById.mockResolvedValue(mockPost);

      await likePost(req, res);

      expect(mockPost.likes).toContain("user1"); // Should add ID
      expect(mockPost.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test("Path 2: Unlike a post (Filter ID)", async () => {
      const req = mockRequest({ _id: "user1" }, {}, { id: "post1" });
      const res = mockResponse();

      const mockPost = {
        likes: ["user1", "user2"], // User1 already liked it
        author: "user2",
        save: jest.fn(),
      };
      Post.findById.mockResolvedValue(mockPost);

      await likePost(req, res);

      // Should remove user1
      expect(mockPost.likes).toEqual(["user2"]);
      expect(mockPost.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
