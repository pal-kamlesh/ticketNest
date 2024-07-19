import { Ticket, TicketHistory } from "../models/ticketModel.js";
import {
  ticketClosed,
  ticketRaised,
  ticketRescheduled,
} from "../services/emailService.js";
import axios from "axios";
import pkg from "lodash";
const { isEqual } = pkg;

const create = async (req, res, next) => {
  try {
    const { _id, ...rest } = req.body;

    const aTicket = await Ticket.find(
      {
        contract: rest.contract,
        $or: [{ status: "Open" }, { status: "Assigned" }],
      },
      {
        "contract.selectedServices": 1,
        createdBy: 1,
        ticketNo: 1,
      }
    )
      .sort({ createdAt: -1 })
      .limit(1);
    if (aTicket.length > 0) {
      const equal = areArraysEqual(
        aTicket[0].contract.selectedServices,
        rest.contract.selectedServices
      );
      if (equal) {
        return res.status(400).json({
          message: `Same ticket is already createdBy: ${aTicket[0].createdBy}, TicketNo: ${aTicket[0].ticketNo} but not closed yet! Please refresh the page.`,
        });
      }
    }

    const newTicket = await Ticket.create(rest);
    await createTicketHistory(newTicket.ticketNo, req.user);

    res.status(200).json({ message: "Ticket created", ticket: newTicket });
  } catch (error) {
    // Handle errors
    next(error);
  }
};

const incPrintCount = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }
    ticket.printcount = Number(ticket.printcount) + 1;

    const updatedTicket = await ticket.save();

    return res.status(200).json({
      message: "Print count incremented successfully",
      ticket: updatedTicket,
    });
  } catch (error) {
    next(error);
  }
};

const getTickets = async (req, res, next) => {
  try {
    const startIndex = parseInt(req.query.startIndex) || 0;
    const limit = parseInt(req.query.limit) || 9;
    const sortDirection = req.query.order === "asc" ? 1 : -1;
    const tickets = await Ticket.find({
      ...(req.query.createdBy && {
        createdBy: { $regex: new RegExp(req.query.createdBy, "i") },
      }),
      ...(req.query.contract && { "contract.number": req.query.contract }),
      ...(req.query.status && { status: req.query.status }),
      ...(req.query.ticketNo && { ticketNo: req.query.ticketNo }),
    })
      .lean()
      .populate("history")
      .sort({ createdAt: sortDirection })
      .skip(startIndex)
      .limit(limit);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const totalTickets = await Ticket.countDocuments();
    const todayTickets = await Ticket.countDocuments({
      createdAt: { $gte: today },
    });

    res.status(200).json({
      tickets,
      totalTickets,
      todayTickets,
    });
  } catch (error) {
    next(error);
  }
};

const getTicket = async (req, res, next) => {
  const { ticketId } = req.params;
  const ticket = await Ticket.find({ _id: ticketId })
    .lean()
    .populate("history");

  if (ticket.length <= 0) {
    res.status(404).json({ message: "NO Ticket Found!" });
  }
  res.status(200).json({ ticket: ticket[0] });
};

const update = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const updateData = req.body;

    // Find the existing ticket document
    const existingTicket = await Ticket.findById(ticketId).lean();

    if (!existingTicket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    // Handle status change to "Assigned"
    if (
      updateData.agent !== "" &&
      updateData.date !== "" &&
      updateData.status === "Open"
    ) {
      updateData.status = "Assigned";
      await ticketRaised(updateData, req.user.username);
      await createTicketHistoryEntry(
        existingTicket.ticketNo,
        existingTicket.status,
        "Assigned",
        req.user
      );
    }

    // Handle status change to "Closed"
    if (updateData.status === "Closed") {
      try {
        await entryToCQR(updateData);
        const updatedTicket = await Ticket.findByIdAndUpdate(
          { _id: ticketId },
          updateData,
          { new: true, runValidators: true }
        ).lean();

        // Populate the history field
        const populatedTicket = await Ticket.populate(updatedTicket, {
          path: "history",
          select: "changes",
        });

        // Create a new TicketHistory document for the status change
        await createTicketHistoryEntry(
          existingTicket.ticketNo,
          existingTicket.status,
          "Closed",
          req.user
        );
        await ticketClosed(updatedTicket, req.user.username);

        return res
          .status(200)
          .json({ message: "Ticket Closed!", ticket: populatedTicket });
      } catch (error) {
        console.error("Error in entryToCQR function:", error.message);
        return res
          .status(500)
          .json({ message: "An error occurred while closing the ticket" });
      }
    }

    // Update the ticket document and populate the history field
    const updatedTicket = await Ticket.findOneAndUpdate(
      { _id: ticketId },
      updateData,
      {
        new: true,
        runValidators: true,
      }
    )
      .lean()
      .populate({
        path: "history",
        select: "changes",
      });

    return res
      .status(200)
      .json({ message: "Ticket Updated!", ticket: updatedTicket });
  } catch (error) {
    next(error);
  }
};

const entryToCQR = async (theTicket) => {
  try {
    const token = await loginToCQR();
    const {
      contract: { selectedServices, number: contract },
      scheduledDate,
      ticketImage,
    } = theTicket;
    const image = ticketImage
      ? ticketImage
      : "https://res.cloudinary.com/epcorn/image/upload/v1712651284/ticketNest/tmp-1-1712651281899_rl1suj.png";
    const comments = "All Job Done";
    const completion = "Complete";
    const serviceDate = scheduledDate;

    const servicesArray = mergeUniqueServices(selectedServices);

    for (const service of servicesArray) {
      const { serviceId, name: serviceName } = service;

      try {
        await axios.post(
          `https://cqr1.herokuapp.com/api/ticketReport/${serviceId}`,
          {
            image,
            comments,
            contract,
            completion,
            serviceDate,
            serviceName,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
      } catch (error) {
        throw new Error(
          `Error sending ticket report for service ${serviceName} (ID: ${serviceId}): ${error.message}`
        );
      }
    }

    return "ok";
  } catch (error) {
    throw new Error(error.message);
  }
};

const reschedule = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { scheduledDate, scheduledTime, message } = req.body;

    if (!scheduledDate || !scheduledTime || !message) {
      return res.status(403).json({
        message: "Please provide scheduledDate, scheduledTime, and message",
      });
    }

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const newChange = {
      fields: {
        scheduledDate: ticket.scheduledDate,
        scheduledTime: ticket.scheduledTime,
      },
      message,
      author: req.user.username,
    };

    const ticketHistory = await TicketHistory.findOneAndUpdate(
      { ticketNo: ticket.ticketNo },
      { $push: { changes: newChange } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const updatedTicket = await Ticket.findByIdAndUpdate(
      ticketId,
      { scheduledDate, scheduledTime },
      { new: true }
    )
      .lean()
      .populate({
        path: "history",
        select: "changes",
      });
    await ticketRescheduled(updatedTicket, req.user.username);
    return res.status(200).json({
      message: "Ticket rescheduled successfully",
      ticket: updatedTicket,
    });
  } catch (error) {
    next(error);
  }
};
const ticketImage = async (req, res, next) => {
  try {
    const { ticketId, link } = req.body;
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }
    const updatedTicket = await Ticket.findByIdAndUpdate(
      ticketId,
      { ticketImage: link },
      { new: true }
    )
      .lean()
      .populate({
        path: "history",
        select: "changes",
      });
    return res.status(200).json({
      message: "Ticket updated",
      ticket: updatedTicket,
    });
  } catch (error) {
    next(error);
  }
};
const getTicketStatusCounts = async (req, res, next) => {
  try {
    const statusCounts = await Ticket.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const data = statusCounts.map((entry) => ({
      name: entry._id,
      value: entry.count,
    }));

    res.status(200).json({ data });
  } catch (error) {
    console.error("Error fetching ticket status counts:", error);
    return [];
  }
};
const getMonthlyTicketChanges = async (req, res, next) => {
  try {
    const monthStatusPipeline = [
      { $unwind: "$changes" },
      {
        $project: {
          year: { $year: "$changes.timestamp" },
          month: { $month: "$changes.timestamp" },
          status: "$changes.fields.status",
        },
      },
      {
        $group: {
          _id: { year: "$year", month: "$month", status: "$status" },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: { year: "$_id.year", month: "$_id.month" },
          statuses: {
            $push: { status: "$_id.status", count: "$count" },
          },
        },
      },
      {
        $project: {
          _id: 0,
          year: "$_id.year",
          month: {
            $arrayElemAt: [
              [
                "",
                "January",
                "February",
                "March",
                "April",
                "May",
                "June",
                "July",
                "August",
                "September",
                "October",
                "November",
                "December",
              ],
              "$_id.month",
            ],
          },
          statuses: 1,
        },
      },
      {
        $addFields: {
          open: {
            $sum: {
              $map: {
                input: "$statuses",
                as: "s",
                in: {
                  $cond: [{ $eq: ["$$s.status", "Open"] }, "$$s.count", 0],
                },
              },
            },
          },
          assigned: {
            $sum: {
              $map: {
                input: "$statuses",
                as: "s",
                in: {
                  $cond: [{ $eq: ["$$s.status", "Assigned"] }, "$$s.count", 0],
                },
              },
            },
          },
          closed: {
            $sum: {
              $map: {
                input: "$statuses",
                as: "s",
                in: {
                  $cond: [{ $eq: ["$$s.status", "Closed"] }, "$$s.count", 0],
                },
              },
            },
          },
        },
      },
      {
        $project: {
          month: 1,
          open: 1,
          assigned: 1,
          closed: 1,
        },
      },
      { $sort: { year: 1, month: -1 } },
    ];
    const data = await TicketHistory.aggregate(monthStatusPipeline);
    res.status(200).json({ data });
  } catch (error) {
    console.error("Error in getMonthlyTicketChanges:", error);
    next(error);
  }
};
const getStatusAvg = async (req, res, next) => {
  try {
    const pipeline4 = [
      // Unwind the changes array
      { $unwind: "$changes" },

      // Group by ticketNo to reconstruct the ticket history
      {
        $group: {
          _id: "$ticketNo",
          changes: {
            $push: {
              status: "$changes.fields.status",
              timestamp: "$changes.timestamp",
            },
          },
        },
      },

      // Project the required fields and calculate time differences
      {
        $project: {
          ticketNo: "$_id",
          openTime: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$changes",
                  as: "change",
                  cond: { $eq: ["$$change.status", "Open"] },
                },
              },
              0,
            ],
          },
          assignedTime: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$changes",
                  as: "change",
                  cond: { $eq: ["$$change.status", "Assigned"] },
                },
              },
              0,
            ],
          },
          closedTime: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$changes",
                  as: "change",
                  cond: { $eq: ["$$change.status", "Closed"] },
                },
              },
              0,
            ],
          },
        },
      },

      // Calculate time differences only if statuses exist
      {
        $project: {
          openToAssign: {
            $cond: {
              if: { $and: ["$openTime", "$assignedTime"] },
              then: {
                $divide: [
                  {
                    $subtract: [
                      "$assignedTime.timestamp",
                      "$openTime.timestamp",
                    ],
                  },
                  60000, // Convert milliseconds to minutes
                ],
              },
              else: null,
            },
          },
          assignToClose: {
            $cond: {
              if: { $and: ["$assignedTime", "$closedTime"] },
              then: {
                $divide: [
                  {
                    $subtract: [
                      "$closedTime.timestamp",
                      "$assignedTime.timestamp",
                    ],
                  },
                  60000, // Convert milliseconds to minutes
                ],
              },
              else: null,
            },
          },
          openToClose: {
            $cond: {
              if: { $and: ["$openTime", "$closedTime"] },
              then: {
                $divide: [
                  {
                    $subtract: ["$closedTime.timestamp", "$openTime.timestamp"],
                  },
                  60000, // Convert milliseconds to minutes
                ],
              },
              else: null,
            },
          },
        },
      },

      // Calculate the average response times, ignoring null values
      {
        $group: {
          _id: null,
          avgOpenToAssign: {
            $avg: {
              $cond: [
                { $ne: ["$openToAssign", null] },
                "$openToAssign",
                "$$REMOVE",
              ],
            },
          },
          avgAssignToClose: {
            $avg: {
              $cond: [
                { $ne: ["$assignToClose", null] },
                "$assignToClose",
                "$$REMOVE",
              ],
            },
          },
          avgOpenToClose: {
            $avg: {
              $cond: [
                { $ne: ["$openToClose", null] },
                "$openToClose",
                "$$REMOVE",
              ],
            },
          },
        },
      },

      // Project the final output
      {
        $project: {
          _id: 0,
          avgOpenToAssign: { $round: ["$avgOpenToAssign", 2] },
          avgAssignToClose: { $round: ["$avgAssignToClose", 2] },
          avgOpenToClose: { $round: ["$avgOpenToClose", 2] },
        },
      },
    ];
    const pipeline5 = [
      // Unwind the changes array
      { $unwind: "$changes" },

      // Group by ticketNo to reconstruct the ticket history
      {
        $group: {
          _id: "$ticketNo",
          changes: {
            $push: {
              status: "$changes.fields.status",
              timestamp: "$changes.timestamp",
            },
          },
        },
      },

      // Project the required fields and calculate time differences
      {
        $project: {
          ticketNo: "$_id",
          openTime: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$changes",
                  as: "change",
                  cond: { $eq: ["$$change.status", "Open"] },
                },
              },
              0,
            ],
          },
          assignedTime: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$changes",
                  as: "change",
                  cond: { $eq: ["$$change.status", "Assigned"] },
                },
              },
              0,
            ],
          },
          closedTime: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$changes",
                  as: "change",
                  cond: { $eq: ["$$change.status", "Closed"] },
                },
              },
              0,
            ],
          },
        },
      },

      // Calculate time differences only if all required statuses exist
      {
        $project: {
          openToAssign: {
            $cond: {
              if: { $and: ["$openTime", "$assignedTime"] },
              then: {
                $divide: [
                  {
                    $subtract: [
                      "$assignedTime.timestamp",
                      "$openTime.timestamp",
                    ],
                  },
                  60000, // Convert milliseconds to minutes
                ],
              },
              else: null,
            },
          },
          assignToClose: {
            $cond: {
              if: { $and: ["$assignedTime", "$closedTime"] },
              then: {
                $divide: [
                  {
                    $subtract: [
                      "$closedTime.timestamp",
                      "$assignedTime.timestamp",
                    ],
                  },
                  60000, // Convert milliseconds to minutes
                ],
              },
              else: null,
            },
          },
          openToClose: {
            $cond: {
              if: { $and: ["$openTime", "$assignedTime", "$closedTime"] },
              then: {
                $divide: [
                  {
                    $subtract: ["$closedTime.timestamp", "$openTime.timestamp"],
                  },
                  60000, // Convert milliseconds to minutes
                ],
              },
              else: null,
            },
          },
        },
      },

      // Calculate the average response times, ignoring null values
      {
        $group: {
          _id: null,
          totalOpenToAssign: {
            $sum: { $cond: [{ $ne: ["$openToAssign", null] }, 1, 0] },
          },
          sumOpenToAssign: {
            $sum: {
              $cond: [{ $ne: ["$openToAssign", null] }, "$openToAssign", 0],
            },
          },
          totalAssignToClose: {
            $sum: { $cond: [{ $ne: ["$assignToClose", null] }, 1, 0] },
          },
          sumAssignToClose: {
            $sum: {
              $cond: [{ $ne: ["$assignToClose", null] }, "$assignToClose", 0],
            },
          },
          totalOpenToClose: {
            $sum: { $cond: [{ $ne: ["$openToClose", null] }, 1, 0] },
          },
          sumOpenToClose: {
            $sum: {
              $cond: [{ $ne: ["$openToClose", null] }, "$openToClose", 0],
            },
          },
        },
      },

      // Calculate averages and project the final output
      {
        $project: {
          _id: 0,
          avgOpenToAssign: {
            $cond: [
              { $gt: ["$totalOpenToAssign", 0] },
              {
                $round: [
                  { $divide: ["$sumOpenToAssign", "$totalOpenToAssign"] },
                  2,
                ],
              },
              null,
            ],
          },
          avgAssignToClose: {
            $cond: [
              { $gt: ["$totalAssignToClose", 0] },
              {
                $round: [
                  { $divide: ["$sumAssignToClose", "$totalAssignToClose"] },
                  2,
                ],
              },
              null,
            ],
          },
          avgOpenToClose: {
            $cond: [
              { $gt: ["$totalOpenToClose", 0] },
              {
                $round: [
                  { $divide: ["$sumOpenToClose", "$totalOpenToClose"] },
                  2,
                ],
              },
              null,
            ],
          },
        },
      },
    ];
    const data = await TicketHistory.aggregate(pipeline5);
    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};

const getServicesCount = async (req, res, next) => {
  try {
    const servicesPipeline = [
      { $unwind: "$contract.selectedServices" },
      {
        $group: { _id: "$contract.selectedServices.name", count: { $sum: 1 } },
      },
    ];
    const d = await Ticket.aggregate(servicesPipeline);
    const data = formattedData(d);
    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};

const getInsectsCount = async (req, res, next) => {
  try {
    const insectsPipeline = [
      { $unwind: "$issue.problem" },
      { $group: { _id: "$issue.problem.label", count: { $sum: 1 } } },
    ];
    const d = await Ticket.aggregate(insectsPipeline);
    const data = formattedData(d);
    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};

const loginToCQR = async () => {
  try {
    const loginResponse = await axios.post(
      "https://cqr1.herokuapp.com/api/login",
      {
        name: process.env.CQR_USER_NAME,
        password: process.env.CQR_USER_PASSWORD,
      }
    );
    return loginResponse.data.token;
  } catch (error) {
    throw new Error("Login to CQR failed!");
  }
};

function mergeUniqueServices(services) {
  const uniqueServices = new Map();

  for (const { name, serviceId } of services) {
    if (!uniqueServices.has(serviceId)) {
      uniqueServices.set(serviceId, name);
    } else {
      uniqueServices.set(
        serviceId,
        `${uniqueServices.get(serviceId)}, ${name}`
      );
    }
  }

  return Array.from(uniqueServices, ([serviceId, name]) => ({
    serviceId,
    name,
  }));
}

function formattedData(data) {
  return data.map((item) => ({
    name: item._id === "Crawling, Flying, Garden bug" ? "Others" : item._id, // Handling null _id
    count: item.count,
  }));
}

async function createTicketHistoryEntry(
  ticketNo,
  prevStatus,
  newStatus,
  author
) {
  const ticketHistory = await TicketHistory.findOne({ ticketNo });

  const newChange = {
    fields: { status: newStatus },
    message: `Status changed from ${prevStatus} to ${newStatus}`,
    author: author.username,
  };

  if (ticketHistory) {
    ticketHistory.changes.push(newChange);
    await ticketHistory.save();
  } else {
    const newTicketHistory = new TicketHistory({
      ticketNo,
      changes: [newChange],
    });
    await newTicketHistory.save();
  }
}

async function createTicketHistory(ticketNo, author) {
  const newChange = {
    fields: { status: "Open" },
    message: "Ticket created with Open status",
    author: author.username,
  };

  const newTicketHistory = new TicketHistory({
    ticketNo,
    changes: [newChange],
  });

  await newTicketHistory.save();
}
function areArraysEqual(array1, array2) {
  return isEqual(array1, array2);
}

export {
  create,
  getTicket,
  getTickets,
  update,
  entryToCQR,
  incPrintCount,
  reschedule,
  ticketImage,
  getTicketStatusCounts,
  getMonthlyTicketChanges,
  getStatusAvg,
  getServicesCount,
  getInsectsCount,
};
