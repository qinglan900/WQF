import clsx, { type ClassValue } from 'clsx';

/** 合并 class 的工具函数 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
