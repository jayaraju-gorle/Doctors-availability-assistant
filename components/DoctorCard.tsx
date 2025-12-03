import React from 'react';
import { Doctor } from '../types';
import { MapPin, Clock, Banknote, Award } from 'lucide-react';

interface DoctorCardProps {
  doctor: Doctor;
}

const DoctorCard: React.FC<DoctorCardProps> = ({ doctor }) => {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-4 hover:shadow-md transition-shadow">
      <div className="flex items-start space-x-4">
        <img 
          src={doctor.image} 
          alt={doctor.name} 
          className="w-16 h-16 rounded-full object-cover bg-gray-200"
        />
        <div className="flex-1">
          <h3 className="font-semibold text-gray-800">{doctor.name}</h3>
          <p className="text-[#024751] text-sm font-medium">{doctor.specialty}</p>
          
          <div className="mt-2 space-y-1">
            <div className="flex items-center text-xs text-gray-500">
              <Award className="w-3 h-3 mr-1.5" />
              <span>{doctor.experience} Exp</span>
            </div>
            <div className="flex items-center text-xs text-gray-500">
              <Banknote className="w-3 h-3 mr-1.5" />
              <span>{doctor.fees} Consultation</span>
            </div>
            <div className="flex items-start text-xs text-gray-500">
              <MapPin className="w-3 h-3 mr-1.5 mt-0.5 flex-shrink-0" />
              <span className="leading-tight">{doctor.location}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DoctorCard;