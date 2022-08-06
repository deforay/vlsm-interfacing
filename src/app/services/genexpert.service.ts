import { Injectable } from '@angular/core';
import { Socket } from 'net';
import { DatabaseService } from './database.service';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronStoreService } from './electron-store.service';
import { InterfaceService } from './interface.service';

@Injectable({
  providedIn: 'root'
})

export class GeneXpertService extends InterfaceService {

  constructor(public dbService: DatabaseService,
    public store: ElectronStoreService) {
    super(dbService, store);
  }

  handleTCPResponse(data: any) {
    const that = this;
    if (that.settings.interfaceCommunicationProtocol === 'hl7') {

      that.logger('error', 'Please connect via ASTM protocol');
      return;

    } else if (that.settings.interfaceCommunicationProtocol === 'astm-concatenated') {

      that.logger('info', 'Processing ASTM/Concatenated in GeneXpert');


      const d = data.toString('hex');



      if (d === '04') {

        that.socketClient.write(that.ACK);

        that.logger('info', 'Received EOT. READY TO SEND');
        //clearTimeout(that.timer);
        //this.logger('info',that.strData);

        // Let us store this Raw Data before we process it
        const rData: any = {};
        rData.data = that.strData;
        rData.machine = that.settings.analyzerMachineName;
        that.dbService.addRawData(rData, (res) => {
          that.logger('success', 'Raw data successfully saved');
        }, (err) => {
          that.logger('error', 'Not able to save raw data : ' + JSON.stringify(err));
        });

        that.processASTMConcatenatedData(that.strData);
        that.strData = "";
      } else if (d === '21') {
        that.socketClient.write(that.ACK);
        that.logger('error', 'NAK Received');
      } else {

        let text = that.hex2ascii(d);
        if (text.match(/^\d*H/)) {
          text = '##START##' + text;
        }
        that.strData += text;
        that.logger('info', that.strData);
        that.socketClient.write(that.ACK);
      }
    }
  }


  processASTMConcatenatedData(astmData: string) {

    //this.logger('info', astmData);

    const that = this;
    astmData = astmData.replace(/[\x05]/g, '');
    astmData = astmData.replace(/\x02/g, "<STX>");
    astmData = astmData.replace(/\x03/g, "<ETX>");
    astmData = astmData.replace(/\x04/g, "<EOT>");
    astmData = astmData.replace(/\x17/g, "<ETB>");
    //astmData = astmData.replace(/\x5E/g, "::")

    astmData = astmData.replace(/\n/g, "<LF>");
    astmData = astmData.replace(/\r/g, "<CR>");

    //Let us remove the transmission blocks
    astmData = astmData.replace(/<ETB>\w{2}<CR><LF>/g, "").replace(/<STX>/g, "");




    const fullDataArray = astmData.split('##START##');

    // that.logger('info', "AFTER SPLITTING USING ##START##");
    // that.logger('info', fullDataArray);


    fullDataArray.forEach(function (partData) {

      if (partData !== '' && partData !== undefined && partData !== null) {

        const astmArray = partData.split(/<CR>/);

        const dataArray = [];

        astmArray.forEach(function (element) {
          if (element !== '') {
            element = element.replace(/^\d*/, '');
            if (dataArray[element.substring(0, 1)] === undefined) {
              dataArray[element.substring(0, 1)] = element.split('|');
            } else {
              const arr = element.split('|');
              arr.shift();
              dataArray[element.substring(0, 1)] += arr;
            }
          }
        });


        //console.log("=== CHOTOA ===");
        //that.logger('info', dataArray);
        //that.logger('info',dataArray['R']);

        if (dataArray === []) {
          that.logger('info', 'dataArray blank');
          return;
        }

        const order: any = {};

        try {

          if (that.arrayKeyExists('R', dataArray) && typeof dataArray['R'] == 'string') {
            dataArray['R'] = dataArray['R'].split(',');
          }

          if (that.arrayKeyExists('O', dataArray) && typeof dataArray['O'] == 'string') {
            dataArray['O'] = dataArray['O'].split(',');
          }

          if (that.arrayKeyExists('C', dataArray) && typeof dataArray['C'] == 'string') {
            dataArray['C'] = dataArray['C'].split(',');
          }



          if (dataArray['O'] !== undefined && dataArray['O'] !== []) {

            order.order_id = dataArray['O'][2];
            order.test_id = dataArray['O'][1];
            if (dataArray['R'] !== undefined && dataArray['R'] !== []) {
              order.test_type = (dataArray['R'][2]) ? dataArray['R'][2].replace('^^^', '') : dataArray['R'][2];
              order.test_unit = dataArray['R'][4];
              order.results = dataArray['R'][3];
              order.tested_by = dataArray['R'][10];
              order.analysed_date_time = that.formatRawDate(dataArray['R'][12]);
              order.authorised_date_time = that.formatRawDate(dataArray['R'][12]);
              order.result_accepted_date_time = that.formatRawDate(dataArray['R'][12]);
            } else {
              order.test_type = '';
              order.test_unit = '';
              order.results = 'Failed';
              order.tested_by = '';
              order.analysed_date_time = '';
              order.authorised_date_time = '';
              order.result_accepted_date_time = '';
            }
            order.raw_text = partData;
            order.result_status = 1;
            order.lims_sync_status = 0;
            order.test_location = that.settings.labName;
            order.machine_used = that.settings.analyzerMachineName;

            if (order.order_id) {
              that.logger('info', "Trying to add order :" + JSON.stringify(order));
              that.dbService.addOrderTest(order, (res) => {
                that.logger('success', 'Result Successfully Added : ' + order.order_id);
              }, (err) => {
                that.logger('error', 'Failed to add : ' + JSON.stringify(err));
              });
            } else {
              that.logger('error', "Could NOT add order :" + JSON.stringify(order));
            }
          }
        }

        catch (error) {
          that.logger('error', error);
          console.error(error);
          return;

        }

        //if (dataArray == undefined || dataArray['0'] == undefined ||
        //      dataArray['O'][3] == undefined || dataArray['O'][3] == null ||
        //        dataArray['O'][3] == '') return;
        //if (dataArray == undefined || dataArray['R'] == undefined
        //        || dataArray['R'][2] == undefined || dataArray['R'][2] == null
        //        || dataArray['R'][2] == '') return;

      }
    });

  }

}
