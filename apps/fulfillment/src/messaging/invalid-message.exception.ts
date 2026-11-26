import { RpcException } from '@nestjs/microservices';

interface Issue {
  message: string;
  path?: readonly (PropertyKey | { key: PropertyKey })[];
}

/** A message that breaks its contract: no retry will make it valid. */
export class InvalidMessageException extends RpcException {
  constructor(issues: readonly Issue[]) {
    const path = (issue: Issue) =>
      issue.path?.map((segment) => String(typeof segment === 'object' ? segment.key : segment)).join('.');
    super({ message: 'Invalid message', issues: issues.map((issue) => `${path(issue)}: ${issue.message}`) });
  }
}
