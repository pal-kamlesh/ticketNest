import { Router } from "express";
import {
  create,
  entryToCQR,
  getTicket,
  getTickets,
  incPrintCount,
  update,
  reschedule,
  ticketImage,
  getTicketStatusCounts,
  getMonthlyTicketChanges,
  getInsectsCount,
  getServicesCount,
  getStatusAvg,
} from "../controller/ticketController.js";
import { verifyToken, ifAssign } from "../middleware/verifyUser.js";

const router = Router();

router.post("/", verifyToken, create);
router.get("/getTickets", verifyToken, getTickets);
router.get("/:ticketId", verifyToken, getTicket);
router.put("/:ticketId", verifyToken, update);
router.get("/:ticketId/cqr", verifyToken, entryToCQR);
router.get("/print/:ticketId", verifyToken, incPrintCount);
router.post("/reschedule/:ticketId", verifyToken, reschedule);
router.post("/updateImage", verifyToken, ticketImage);
router.get("/stats/ticketStatusCounts", getTicketStatusCounts);
router.get("/stats/getMonthlyStat", getMonthlyTicketChanges);
router.get("/stats/insectsCount", getInsectsCount);
router.get("/stats/serviceCount", getServicesCount);
router.get("/stats/statusAvg", getServicesCount);

export default router;
