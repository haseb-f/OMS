import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

/** Search (name/phone/email) + pagination — same shared shape every Master-Data-style list endpoint uses. */
export class InvestorsQueryDto extends MasterDataQueryDto {}
