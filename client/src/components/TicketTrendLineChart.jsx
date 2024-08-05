/* eslint-disable react/prop-types */
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const TicketTrendLineChart = ({ data }) => (
  <ResponsiveContainer width="100%" height={400}>
    <LineChart
      width={100}
      height={400}
      data={data}
      margin={{
        top: 5,
        right: 30,
        left: 20,
        bottom: 5,
      }}
    >
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="month" />
      <YAxis />
      <Tooltip />
      <Legend />
      <Line type="monotone" dataKey="open" stroke="#8884d8" />
      <Line type="monotone" dataKey="closed" stroke="#82ca9d" />
      <Line type="monotone" dataKey="assigned" stroke="#ffc658" />
    </LineChart>
  </ResponsiveContainer>
);

export default TicketTrendLineChart;
