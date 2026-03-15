function timestamp(): string {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

export const log = {
  info: (msg: string) => console.log(`${timestamp()} [INFO]  ${msg}`),
  error: (msg: string) => console.error(`${timestamp()} [ERROR] ${msg}`),
};
