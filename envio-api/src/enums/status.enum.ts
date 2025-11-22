export enum HttpStatus {
  OK = 200,
  CREATED = 201,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  INTERNAL_SERVER_ERROR = 500,
}

export enum OrderStatus {
  OPEN = 0,
  FILLED = 1,
  CANCELLED = 2,
  PARTIALLY_FILLED = 3,
}

export enum OrderSide {
  BUY = 0,
  SELL = 1,
}
