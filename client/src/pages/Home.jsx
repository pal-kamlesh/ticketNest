import TicketTrendLineChart from "../components/TicketTrendLineChart";
import TicketPieChart from "../components/TicketStatusPieChart";
import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import {
  getInsectsCount,
  getMonthlyStatusCount,
  getServiceCount,
  getStatusAvg,
  getStatusCount,
} from "../redux/creater/createrSlice";
import { unwrapResult } from "@reduxjs/toolkit";
import PestBarChart from "../components/PestBarChart";

export default function Home() {
  const dispatch = useDispatch();
  const [statusCount, setStatusCount] = useState([]);
  const [monthlyCount, setMonthlyCount] = useState([]);
  const [insectsCount, setInsectsCount] = useState([]);
  const [serviceCount, setServiceCount] = useState([]);
  const [statusAvg, setStatusAvg] = useState({});

  useEffect(() => {
    async function get() {
      const a1 = await dispatch(getStatusCount());
      const a2 = await dispatch(getMonthlyStatusCount());
      const a3 = await dispatch(getInsectsCount());
      const a4 = await dispatch(getServiceCount());
      const a5 = await dispatch(getStatusAvg());
      const r1 = unwrapResult(a1);
      const r2 = unwrapResult(a2);
      const r3 = unwrapResult(a3);
      const r4 = unwrapResult(a4);
      const r5 = unwrapResult(a5);
      setStatusCount(r1.data);
      setMonthlyCount(r2.data);
      setInsectsCount(r3.data);
      setServiceCount(r4.data);
      setStatusAvg(r5.data);
    }
    get();
  }, [dispatch]);
  console.log(statusCount);
  return (
    <div className="max-w-7xl mx-auto min-h-screen border mt-2 ">
      {/* <div className="grid grid-cols-12">
        <div className=" col-span-8">
          <TicketTrendLineChart data={monthlyCount} />
        </div>
        <div className=" col-span-4">
          <TicketPieChart data={statusCount} />
        </div>
        <div className=" col-span-12">
          <PestBarChart data={insectsCount} />
        </div>
        <div className=" col-span-12">
          <PestBarChart data={serviceCount} />
        </div>
      </div> */}
    </div>
  );
}
