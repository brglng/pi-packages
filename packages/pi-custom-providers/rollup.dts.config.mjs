import { dts } from "rollup-plugin-dts";

const external = [/^@earendil-works\//, /^node:/];

export default [
  {
    input: "src/index.ts",
    output: { file: "dist/public.d.ts", format: "es" },
    external,
    plugins: [dts({ tsconfig: "./tsconfig.json" })],
  },
];
