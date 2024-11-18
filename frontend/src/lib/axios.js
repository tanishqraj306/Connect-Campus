import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

export const axiosInstance = axios.create({
  baseURL: process.env.CLIENT_URL,
  withCredentials: true,
});
