import type { AwcpFieldError } from '@app/awcp';
import type { DemoRepository } from '../../common/store/repository';
import { SuitabilityService } from './suitabilityService';
import { ResearchService } from './researchService';
import { IbProjectService } from './ibProjectService';
import { RiskAlertService } from './riskAlertService';
import { InstitutionService } from './institutionService';

/** Check the same domain read rules before mounting a restricted detail page. */
export function businessPageReadValidator(
  repository: DemoRepository,
  sceneId: string,
  objectId: string
): ((actorId: string) => AwcpFieldError[]) | undefined {
  switch (sceneId) {
    case 'S01': {
      const service = new SuitabilityService(repository);
      return (actorId) => service.validateRead({ clientId: objectId, actorId });
    }
    case 'S02': {
      const service = new ResearchService(repository);
      return (actorId) => service.validateRead({ reportId: objectId, actorId });
    }
    case 'S03': {
      const service = new IbProjectService(repository);
      return (actorId) => service.validateRead({ projectId: objectId, actorId });
    }
    case 'S04': {
      const service = new RiskAlertService(repository);
      return (actorId) => service.validateRead({ alertId: objectId, actorId });
    }
    case 'S05': {
      const service = new InstitutionService(repository);
      return (actorId) => service.validateEntitlement({ needId: objectId, actorId });
    }
  }
}
