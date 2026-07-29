import { IsNotEmpty, IsString } from 'class-validator';

export class AddTrackingNumberDto {
  @IsString()
  @IsNotEmpty()
  trackingNumber!: string;
}
