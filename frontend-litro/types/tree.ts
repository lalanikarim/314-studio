export interface TreeNodeData {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNodeData[];
}
