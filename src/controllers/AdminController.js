import { User, Order, Product, DailySales } from '../models/index.js';
import { successResponse, NotFoundError } from '../middleware/error.js';

class AdminController {
  static async listUsers(req, res) {
    const users = await User.find().sort({ createdAt: -1 }).limit(200);
    return successResponse(res, users);
  }

  static async updateUser(req, res) {
    const { id } = req.params;
    const updates = req.body;
    const user = await User.findByIdAndUpdate(id, updates, { new: true });
    if (!user) throw new NotFoundError('User');
    return successResponse(res, user, 'User updated');
  }

  static async listAllOrders(req, res) {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(500);
    return successResponse(res, orders);
  }

  static async analytics(req, res) {
    const { merchantId, startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    const summary = await DailySales.getSummary(merchantId, 30);
    return successResponse(res, { summary });
  }

  static async sales(req, res) {
    const { merchantId, startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    const range = await DailySales.getDateRange(merchantId, start, end);
    return successResponse(res, range);
  }
}

export default AdminController;


